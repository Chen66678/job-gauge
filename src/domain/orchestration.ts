import type {
  JobPosting,
  JobRequirement,
  JobRisk,
  MaterialPreview,
  PreferenceRuleSet,
  ProfileFact,
  ProfileFactGroup,
  ScoreResult,
  UserProfile
} from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { extractFactsAndGroupsFromResume, extractFactsFromResume } from "./resumeExtraction";
import { extractRequirementsFromJd } from "./jdExtraction";
import { type HardVetoRule, type HardVetoRules, findVetoHit, parsePreferences } from "./preferenceParsing";
import {
  type FollowUpQuestion,
  generateFollowUpQuestions,
  generateResumeFollowUpQuestions,
  ingestFollowUpAnswers
} from "./followUp";
import { type RiskSensitivity, scoreJobWithLlm } from "./llmScoring";
import { draftApplicationMaterial } from "./materialDrafting";
import { sanitizeGreeting } from "./greetingGuard";

export async function ingestResume(input: {
  resume: { kind: "text"; resumeText: string };
  client: OpenAiCompatibleLlmClient;
}): Promise<ProfileFact[]> {
  return extractFactsFromResume({
    kind: "text",
    resumeText: input.resume.resumeText,
    client: input.client
  });
}

// D034②：与 ingestResume 并行的入口，多带出父级分组（同一段工作经历/项目），
// 供 coreApi 写入 CoreState.factGroups。ingestResume 本身不变，避免动到既有调用方。
export async function ingestResumeWithGroups(input: {
  resume: { kind: "text"; resumeText: string };
  client: OpenAiCompatibleLlmClient;
}): Promise<{ facts: ProfileFact[]; groups: ProfileFactGroup[] }> {
  return extractFactsAndGroupsFromResume({
    kind: "text",
    resumeText: input.resume.resumeText,
    client: input.client
  });
}

export async function ingestJd(input: {
  jdText: string;
  client: OpenAiCompatibleLlmClient;
}): Promise<{ requirements: JobRequirement[]; risks: JobRisk[] }> {
  return extractRequirementsFromJd(input);
}

export async function ingestPreferences(input: {
  acceptText: string;
  vetoText: string;
  client: OpenAiCompatibleLlmClient;
}): Promise<{
  preferences: PreferenceRuleSet;
  riskSensitivity: RiskSensitivity;
  hardVeto: HardVetoRules;
}> {
  return parsePreferences({
    acceptText: input.acceptText,
    vetoText: input.vetoText,
    client: input.client
  });
}

export function assembleJobPosting(input: {
  base: {
    title: string;
    company: string;
    city: string;
    salaryK: [number, number];
    companyTags: string[];
    jdText: string;
    workAddress?: string | null;
    sourceUrl?: string | null;
  };
  requirements: JobRequirement[];
  risks: JobRisk[];
}): JobPosting {
  return {
    id: buildJobId(input.base),
    title: input.base.title,
    company: input.base.company,
    city: input.base.city,
    salaryK: input.base.salaryK,
    companyTags: input.base.companyTags,
    jdText: input.base.jdText,
    requirements: input.requirements,
    risks: input.risks,
    reviewFlags: [],
    pinned: false,
    workAddress: input.base.workAddress ?? null,
    sourceUrl: input.base.sourceUrl ?? null
  };
}

export async function evaluateJob(input: {
  profile: UserProfile;
  job: JobPosting;
  client: OpenAiCompatibleLlmClient;
  riskSensitivity?: RiskSensitivity;
  hardVeto?: HardVetoRules;
  preferences?: PreferenceRuleSet;
}): Promise<{ vetoed: true; vetoRule: HardVetoRule } | { vetoed: false; score: ScoreResult }> {
  const vetoRule = input.hardVeto ? findVetoHit(input.job, input.hardVeto) : null;
  if (vetoRule) {
    return { vetoed: true, vetoRule };
  }

  const score = await scoreJobWithLlm({
    profile: input.profile,
    job: input.job,
    client: input.client,
    riskSensitivity: input.riskSensitivity,
    preferences: input.preferences
  });

  return { vetoed: false, score };
}

export async function buildFollowUps(input: {
  job: JobPosting;
  scoreResult: ScoreResult;
  client: OpenAiCompatibleLlmClient;
  maxQuestions?: number;
}): Promise<FollowUpQuestion[]> {
  return generateFollowUpQuestions(input);
}

export async function buildResumeFollowUps(input: {
  facts: ProfileFact[];
  client: OpenAiCompatibleLlmClient;
  maxQuestions?: number;
}): Promise<FollowUpQuestion[]> {
  return generateResumeFollowUpQuestions(input);
}

export async function applyFollowUpAnswers(input: {
  questions: FollowUpQuestion[];
  answers: { questionId: string; answerText: string }[];
  client: OpenAiCompatibleLlmClient;
}): Promise<ProfileFact[]> {
  return ingestFollowUpAnswers(input);
}

export async function draftMaterial(input: {
  profile: UserProfile;
  job: JobPosting;
  scoreResult: ScoreResult;
  client: OpenAiCompatibleLlmClient;
}): Promise<MaterialPreview> {
  const material = await draftApplicationMaterial(input);
  return {
    ...material,
    greeting: sanitizeGreeting(material.greeting, input.profile.facts, [input.job.company])
  };
}

export async function runFullChainForDemo(input: {
  resume: { kind: "text"; resumeText: string };
  jdText: string;
  jobBase: {
    title: string;
    company: string;
    city: string;
    salaryK: [number, number];
    companyTags: string[];
  };
  acceptText: string;
  vetoText: string;
  confirmAllFacts?: boolean;
  client: OpenAiCompatibleLlmClient;
}): Promise<{
  facts: ProfileFact[];
  requirements: JobRequirement[];
  risks: JobRisk[];
  job: JobPosting;
  preferences: PreferenceRuleSet;
  riskSensitivity: RiskSensitivity;
  hardVeto: HardVetoRules;
  evaluation: { vetoed: true; vetoRule: HardVetoRule } | { vetoed: false; score: ScoreResult };
  followUps: FollowUpQuestion[];
  material: MaterialPreview | null;
}> {
  const facts = await ingestResume({ resume: input.resume, client: input.client });
  const { requirements, risks } = await ingestJd({ jdText: input.jdText, client: input.client });
  const { preferences, riskSensitivity, hardVeto } = await ingestPreferences({
    acceptText: input.acceptText,
    vetoText: input.vetoText,
    client: input.client
  });
  const job = assembleJobPosting({
    base: {
      title: input.jobBase.title,
      company: input.jobBase.company,
      city: input.jobBase.city,
      salaryK: input.jobBase.salaryK,
      companyTags: input.jobBase.companyTags,
      jdText: input.jdText
    },
    requirements,
    risks
  });

  const profile = buildDemoProfile(facts, input.resume, input.confirmAllFacts === true);
  const evaluation = await evaluateJob({
    profile,
    job,
    client: input.client,
    riskSensitivity,
    hardVeto
  });

  if (evaluation.vetoed) {
    return {
      facts,
      requirements,
      risks,
      job,
      preferences,
      riskSensitivity,
      hardVeto,
      evaluation,
      followUps: [],
      material: null
    };
  }

  const followUps = await buildFollowUps({
    job,
    scoreResult: evaluation.score,
    client: input.client
  });
  const material = await draftMaterial({
    profile,
    job,
    scoreResult: evaluation.score,
    client: input.client
  });

  return {
    facts,
    requirements,
    risks,
    job,
    preferences,
    riskSensitivity,
    hardVeto,
    evaluation,
    followUps,
    material
  };
}

function buildDemoProfile(
  facts: ProfileFact[],
  resume: { kind: "text"; resumeText: string },
  confirmAllFacts: boolean
): UserProfile {
  return {
    id: "profile-demo-orchestration",
    displayName: "演示候选人",
    headline: "待确认画像",
    targetRoles: [],
    targetCities: [],
    resumeText: resume.resumeText,
    facts: confirmAllFacts ? facts.map((fact) => ({ ...fact, status: "confirmed" as const })) : facts
  };
}

function buildJobId(base: {
  title: string;
  company: string;
  city: string;
  salaryK: [number, number];
  companyTags: string[];
  jdText: string;
}): string {
  const slug = `${base.company}-${base.title}-${base.city}`
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `job-${slug || "item"}`;
}
