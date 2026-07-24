import type { JobPosting, ProfileFact, RequirementResult, ScoreResult } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";

export interface FollowUpQuestion {
  id: string;
  requirementId: string;
  kind: "probe" | "explore";
  question: string;
  rationale: string;
}

/** 简历阶段反问不绑定具体岗位，用这个占位值填充 requirementId（复用 FollowUpQuestion 结构与 ingestFollowUpAnswers）。 */
export const RESUME_FOLLOW_UP_REQUIREMENT_ID = "resume-refine";

/** 0.1 可选减负：明显否定就不调 LLM，省一次请求。不是红线防线，不追求准确率。
 * 语义级否定判断留给 0.3 内容评测域。这里宁可漏检（放行调 LLM），
 * 因为真正的红线闸门在下面：LLM 只能提炼“明确肯定”内容，提炼不出就不产生 fact。
 */
export function isNegativeResponse(userAnswer: string): boolean {
  const normalized = userAnswer.trim().toLocaleLowerCase();
  const obviousNegatives = ["没有", "没做过", "不会", "不曾", "从未", "no", "not", "never", "haven't", "hasn't"];
  return obviousNegatives.some((word) => normalized.includes(word));
}

interface FollowUpQuestionEnvelope {
  questions: FollowUpQuestionItem[];
}

interface FollowUpQuestionItem {
  requirementId: string;
  kind: "probe" | "explore";
  question: string;
  rationale: string;
}

interface FollowUpFactEnvelope {
  facts: FollowUpFactItem[];
}

interface FollowUpFactItem {
  category: string;
  label: string;
  value: string;
  confidence: number;
  fromQuestionId: string;
}

const DEFAULT_MAX_QUESTIONS = 5;

// 简历阶段反问：为整个人建库，题量高于岗位缺口反问。
const RESUME_MIN_QUESTIONS = 5;
const RESUME_MAX_QUESTIONS = 10;
const RESUME_DEFAULT_QUESTIONS = 8;

const RESUME_FOLLOW_UP_QUESTION_SYSTEM_PROMPT = [
  "You generate follow-up questions to refine a candidate's resume-derived fact library and return json.",
  "Input is a list of facts already extracted from the resume. Your job is to find what is vague, incomplete, or worth deepening.",
  "Ask about: ambiguous responsibility boundaries (what the candidate personally did vs. team/AI), the exact meaning behind numbers or metrics, real depth of a listed skill, project status (shipped/used/tested vs. planned), and scope of experience.",
  "Prefer questions that turn a thin resume line into a verifiable, specific fact.",
  "Do not invent facts, experience, or details the candidate did not provide.",
  "Questions must be open and non-leading. Never pressure the candidate to claim experience they may not have.",
  "Use Chinese for every question.",
  'Always include exactly one open catch-all question near the end asking whether there is relevant experience, project, or skill NOT written on the resume.',
  'For every question use kind "explore".',
  'Return json with exactly this shape: {"questions":[{"kind":"explore","question":"...","rationale":"..."}]}',
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

const FOLLOW_UP_QUESTION_SYSTEM_PROMPT = [
  "You generate follow-up questions for missing job-match evidence and return json.",
  "Base every question only on the provided requirement, evidence, and gap type.",
  "Do not invent requirements, facts, or user experience.",
  "Use Chinese for every question.",
  'For gap type implied, use kind "probe" and ask an evidence-digging question based on the apparent clue.',
  'For gap type none, use kind "explore" and ask a direct but non-leading question about whether the user has relevant experience.',
  "Questions must be specific, answerable, and must not pressure the user to claim experience they do not have.",
  'Return json with exactly this shape: {"questions":[{"requirementId":"...","kind":"probe|explore","question":"...","rationale":"..."}]}',
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

const FOLLOW_UP_ANSWER_SYSTEM_PROMPT = [
  "You extract user-confirmed ability facts from follow-up answers and return json.",
  "This is a truthfulness-sensitive task.",
  "If the user answer says no, not really, never, unsure, uncertain, forgotten, or does not answer the question, do not produce a fact.",
  "Only produce a fact when the user explicitly affirms they did, can do, have done, or have experience with the capability.",
  "Do not treat the question text itself as evidence.",
  "Do not invent abilities, projects, durations, metrics, or tools that the user did not explicitly say.",
  'Every extracted fact will still be unconfirmed later, so only extract conservative user-answer facts into json.',
  'Return json with exactly this shape: {"facts":[{"category":"...","label":"...","value":"...","confidence":0.0,"fromQuestionId":"..."}]}',
  "Confidence means how clearly the user answer supports the fact, not how strong the candidate is.",
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

export async function generateFollowUpQuestions(input: {
  job: JobPosting;
  scoreResult: ScoreResult;
  client: OpenAiCompatibleLlmClient;
  maxQuestions?: number;
}): Promise<FollowUpQuestion[]> {
  const candidates = input.scoreResult.breakdown.requirements.filter((item) => item.gap !== null);
  if (candidates.length === 0) {
    return [];
  }

  const limit = normalizeMaxQuestions(input.maxQuestions);
  const raw = await input.client.completeText({
    system: FOLLOW_UP_QUESTION_SYSTEM_PROMPT,
    user: buildQuestionUserPrompt(input.job, candidates),
    responseFormatJson: true
  });

  const parsed = parseQuestionEnvelope(raw);
  if (!parsed) {
    return [];
  }

  const requirementById = new Map(candidates.map((item) => [item.requirementId, item] as const));

  return parsed.questions.flatMap((item, index) => {
    const requirement = requirementById.get(item.requirementId);
    if (!requirement) {
      return [];
    }

    const question = item.question.trim();
    const rationale = item.rationale.trim();
    if (!question || !rationale) {
      return [];
    }

    return [
      {
        id: buildQuestionId(item, index),
        requirementId: item.requirementId,
        kind: normalizeQuestionKind(item.kind, requirement.gap),
        question,
        rationale
      } satisfies FollowUpQuestion
    ];
  }).slice(0, limit);
}

export async function generateResumeFollowUpQuestions(input: {
  facts: ProfileFact[];
  client: OpenAiCompatibleLlmClient;
  maxQuestions?: number;
}): Promise<FollowUpQuestion[]> {
  const sourceFacts = input.facts.filter((fact) => fact.status !== "rejected");
  if (sourceFacts.length === 0) {
    return [];
  }

  const limit = normalizeResumeMaxQuestions(input.maxQuestions);
  const raw = await input.client.completeText({
    system: RESUME_FOLLOW_UP_QUESTION_SYSTEM_PROMPT,
    user: buildResumeQuestionUserPrompt(sourceFacts, limit),
    responseFormatJson: true
  });

  const parsed = parseQuestionEnvelope(raw, { requireRequirementId: false });
  if (!parsed) {
    return [];
  }

  return parsed.questions.flatMap((item, index) => {
    const question = item.question.trim();
    const rationale = item.rationale.trim();
    if (!question || !rationale) {
      return [];
    }

    return [
      {
        id: buildQuestionId({ requirementId: RESUME_FOLLOW_UP_REQUIREMENT_ID, question }, index),
        requirementId: RESUME_FOLLOW_UP_REQUIREMENT_ID,
        kind: "explore",
        question,
        rationale
      } satisfies FollowUpQuestion
    ];
  }).slice(0, limit);
}

export async function ingestFollowUpAnswers(input: {
  questions: FollowUpQuestion[];
  answers: { questionId: string; answerText: string }[];
  client: OpenAiCompatibleLlmClient;
}): Promise<ProfileFact[]> {
  if (input.questions.length === 0 || input.answers.length === 0) {
    return [];
  }

  const pairedAnswers = input.answers
    .map((answer) => ({
      question: input.questions.find((question) => question.id === answer.questionId) ?? null,
      answerText: answer.answerText.trim()
    }))
    .filter((item): item is { question: FollowUpQuestion; answerText: string } => Boolean(item.question) && Boolean(item.answerText));

  if (pairedAnswers.length === 0) {
    return [];
  }

  const affirmativeAnswers = pairedAnswers.filter((item) => !isNegativeResponse(item.answerText));
  if (affirmativeAnswers.length === 0) {
    return [];
  }

  const raw = await input.client.completeText({
    system: FOLLOW_UP_ANSWER_SYSTEM_PROMPT,
    user: buildAnswerUserPrompt(affirmativeAnswers),
    responseFormatJson: true
  });

  const parsed = parseFactEnvelope(raw);
  if (!parsed) {
    return [];
  }

  const questionById = new Map(input.questions.map((question) => [question.id, question] as const));

  return parsed.facts.flatMap((item, index) => {
    const question = questionById.get(item.fromQuestionId);
    if (!question) {
      return [];
    }

    const label = item.label.trim();
    const value = item.value.trim();
    const category = item.category.trim();
    if (!label || !value || !category) {
      return [];
    }

    return [
      {
        id: buildFactId(item, index),
        category,
        label,
        value,
        sourceType: "user_answer",
        sourceRef: `反问:${question.question.slice(0, 20)}`,
        status: "unconfirmed",
        confidence: clampConfidence(item.confidence)
      } satisfies ProfileFact
    ];
  });
}

function buildQuestionUserPrompt(job: JobPosting, requirements: RequirementResult[]): string {
  return JSON.stringify(
    {
      job: {
        id: job.id,
        title: job.title,
        company: job.company
      },
      gapRequirements: requirements.map((item) => ({
        requirementId: item.requirementId,
        label: item.label,
        kind: item.kind,
        evidence: item.evidence,
        gap: item.gap
      }))
    },
    null,
    2
  );
}

function buildAnswerUserPrompt(items: Array<{ question: FollowUpQuestion; answerText: string }>): string {
  return JSON.stringify(
    {
      answeredQuestions: items.map((item) => ({
        questionId: item.question.id,
        requirementId: item.question.requirementId,
        kind: item.question.kind,
        question: item.question.question,
        answerText: item.answerText
      }))
    },
    null,
    2
  );
}

function parseQuestionEnvelope(
  raw: string,
  options?: { requireRequirementId?: boolean }
): FollowUpQuestionEnvelope | null {
  const requireRequirementId = options?.requireRequirementId ?? true;
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const withoutFence = stripMarkdownFence(normalized);

  let value: unknown;
  try {
    value = JSON.parse(withoutFence);
  } catch {
    return null;
  }

  if (!isRecord(value) || !Array.isArray(value.questions)) {
    return null;
  }

  return {
    questions: value.questions
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        // 简历阶段模型不返回 requirementId/kind，用占位值补齐，统一走同一校验/结构。
        requirementId: requireRequirementId ? item.requirementId : item.requirementId ?? RESUME_FOLLOW_UP_REQUIREMENT_ID,
        kind: requireRequirementId ? item.kind : normalizeExploreKind(item.kind),
        question: item.question,
        rationale: item.rationale
      }))
      .filter(isQuestionItem)
  };
}

function parseFactEnvelope(raw: string): FollowUpFactEnvelope | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const withoutFence = stripMarkdownFence(normalized);

  let value: unknown;
  try {
    value = JSON.parse(withoutFence);
  } catch {
    return null;
  }

  if (!isRecord(value) || !Array.isArray(value.facts)) {
    return null;
  }

  return {
    facts: value.facts
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        category: item.category,
        label: item.label,
        value: item.value,
        confidence: item.confidence,
        fromQuestionId: item.fromQuestionId
      }))
      .filter(isFactItem)
  };
}

function normalizeQuestionKind(kind: FollowUpQuestion["kind"], gap: string | null): FollowUpQuestion["kind"] {
  if (gap === "疑似具备,建议反问确认") {
    return "probe";
  }
  if (gap === "缺少匹配证据") {
    return "explore";
  }
  return kind;
}

function normalizeMaxQuestions(value: number | undefined): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return DEFAULT_MAX_QUESTIONS;
  }
  return value;
}

function normalizeExploreKind(kind: unknown): FollowUpQuestion["kind"] {
  return kind === "probe" ? "probe" : "explore";
}

function normalizeResumeMaxQuestions(value: number | undefined): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return RESUME_DEFAULT_QUESTIONS;
  }
  return Math.min(RESUME_MAX_QUESTIONS, Math.max(RESUME_MIN_QUESTIONS, value));
}

function buildResumeQuestionUserPrompt(facts: ProfileFact[], limit: number): string {
  return JSON.stringify(
    {
      instruction: `Generate between ${RESUME_MIN_QUESTIONS} and ${limit} refinement questions. Include exactly one open catch-all question about experience not on the resume.`,
      resumeFacts: facts.map((fact) => ({
        category: fact.category,
        label: fact.label,
        value: fact.value
      }))
    },
    null,
    2
  );
}

function buildQuestionId(item: { requirementId: string; question: string }, index: number): string {
  const slug = slugify(`${item.requirementId}-${item.question}`);
  return `followup-q-${index + 1}-${slug}`;
}

function buildFactId(item: FollowUpFactItem, index: number): string {
  const slug = slugify(`${item.category}-${item.label}`);
  return `fact-followup-${index + 1}-${slug}`;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(3));
}

function stripMarkdownFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "item";
}

function isQuestionItem(value: unknown): value is FollowUpQuestionItem {
  return (
    isRecord(value) &&
    typeof value.requirementId === "string" &&
    (value.kind === "probe" || value.kind === "explore") &&
    typeof value.question === "string" &&
    typeof value.rationale === "string"
  );
}

function isFactItem(value: unknown): value is FollowUpFactItem {
  return (
    isRecord(value) &&
    typeof value.category === "string" &&
    typeof value.label === "string" &&
    typeof value.value === "string" &&
    typeof value.confidence === "number" &&
    typeof value.fromQuestionId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
