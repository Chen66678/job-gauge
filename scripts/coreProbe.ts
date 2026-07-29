import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLlmClient } from "../src/domain/llmClient";
import { extractFactsFromResume } from "../src/domain/resumeExtraction";
import { extractRequirementsFromJd } from "../src/domain/jdExtraction";
import { ingestFollowUpAnswers, type FollowUpQuestion } from "../src/domain/followUp";
import { scoreJobWithLlm } from "../src/domain/llmScoring";
import { draftApplicationMaterial } from "../src/domain/materialDrafting";
import { draftMaterial as orchestrateDraftMaterial } from "../src/domain/orchestration";
import type { JobPosting, JobRequirement, MaterialPreview, ProfileFact, RequirementResult, UserProfile } from "../src/types";
import type { CoreState } from "../src/domain/coreState";

type ProbeStatus = "PASS" | "SUSPECT" | "ERROR";

interface ProbeOutcome {
  title: string;
  status: ProbeStatus;
  reasons: string[];
  body: string[];
  elapsedMs: number;
}

interface RawScoringMatchEnvelope {
  matches: Array<{
    requirementId?: unknown;
    matchLevel?: unknown;
    factIds?: unknown;
    reason?: unknown;
  }>;
}

interface RawFollowUpFactEnvelope {
  facts: Array<{
    category?: unknown;
    label?: unknown;
    value?: unknown;
    confidence?: unknown;
    fromQuestionId?: unknown;
  }>;
}

interface RawDraftEnvelope {
  greeting?: unknown;
  resumeLines?: Array<{
    text?: unknown;
    factIds?: unknown;
  }>;
}

const PROBE_RESUME_TEXT = `
李想
应届毕业生，目标岗位：前端开发工程师

教育背景
- 华东理工大学 软件工程 本科 2022-2026

项目经历
- 校园二手平台前端负责人：使用 React 和 TypeScript 开发商品列表、详情页和发布流程。
- 与一名同学协作完成管理后台，负责表单校验、路由拆分和接口联调。

实践经历
- 在学校实验室做过 Python 数据清洗脚本，整理问卷结果并导出报表。
- 能阅读常见前端英文文档，日常使用 Git 进行代码协作。
`.trim();

const PROBE_JD_TEXT = `
岗位：前端开发工程师（校招）
职责：
1. 负责 React 技术栈下的业务页面和可复用组件开发。
2. 参与 TypeScript 工程化建设，和后端完成接口联调。
3. 加分项：有 Python 数据处理经验，能快速编写内部工具脚本。
4. 候选人需要具备良好的协作能力和英文文档阅读能力。
`.trim();

const DRAFT_PROBE_FACTS: ProfileFact[] = [
  {
    id: "fact-probe-python",
    category: "技能",
    label: "Python",
    value: "会用 Python 编写基础数据处理脚本",
    sourceType: "resume",
    sourceRef: "probe_sparse_resume",
    status: "confirmed",
    confidence: 0.95
  }
];

const DRAFT_PROBE_JD_TEXT = `
岗位：高级前端平台工程师
要求：
1. 精通 React 和 TypeScript，能够独立搭建复杂前端架构。
2. 熟悉 Kubernetes / K8s 容器编排，有线上集群维护经验。
3. 3年以上中大型 Web 项目经验，能主导跨团队交付。
4. 加分项：了解 Python 自动化脚本。
`.trim();

const NEGATIVE_ANSWERS = [
  { questionId: "followup-neg-1", answerText: "没有，我没做过这个。" },
  { questionId: "followup-neg-2", answerText: "不太确定，可能没有吧。" },
  { questionId: "followup-neg-3", answerText: "完全没接触过。" }
];

const POSITIVE_ANSWERS = [
  { questionId: "followup-pos-1", answerText: "对，我用 React 做过三个课程项目，负责组件拆分和页面开发。" },
  { questionId: "followup-pos-2", answerText: "有，我做过 TypeScript 页面重构，也和后端联调过接口。" }
];

const SCORING_SYSTEM_PROMPT = [
  "You perform semantic matching between confirmed profile facts and job requirements and return json.",
  "You only decide whether the provided confirmed facts support each requirement.",
  "You must not invent abilities, experience, evidence, or fact ids.",
  "You must not output any numeric scores, weights, percentages, rankings, totals, or floating point values.",
  'For each requirement, return exactly one matchLevel: "none", "implied", or "direct".',
  "direct means the confirmed facts explicitly satisfy the requirement.",
  "implied means the confirmed facts do not state the requirement verbatim, but they strongly and reasonably imply it.",
  "none means there is no reliable support from the confirmed facts.",
  "factIds may only reference the exact fact ids from the provided confirmed facts list.",
  "If there is no supporting confirmed fact, use matchLevel none and an empty factIds array.",
  "Do not invent missing fact ids. Do not cite facts that were not provided.",
  'Return json with exactly this shape: {"matches":[{"requirementId":"...","matchLevel":"none|implied|direct","factIds":["..."],"reason":"..."}]}',
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

const MATERIAL_DRAFTING_SYSTEM_PROMPT = [
  "You draft tailored application materials from confirmed facts and return json.",
  "You may only reorganize or restate the provided confirmed facts to better fit the job.",
  "Do not invent any experience, skill, project, metric, duration, employer, tool, or company.",
  "Every resume line must be traceable to the provided confirmed fact ids only.",
  "factIds may only reference the exact confirmed fact ids provided in the input.",
  "If a job requirement lacks confirmed fact support, do not write content for it.",
  "The greeting must be short, in Chinese, and based only on real confirmed match points.",
  "Do not exaggerate or claim unsupported ability.",
  'Return json with exactly this shape: {"greeting":"...","resumeLines":[{"text":"...","factIds":["fact-..."]}]}',
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

async function main(): Promise<void> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.log("请用 DASHSCOPE_API_KEY=... 运行");
    process.exit(1);
  }

  const timeoutMs = parsePositiveInt(process.env.PROBE_TIMEOUT_MS) ?? 120_000;
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen3.7-plus";
  const baseUrl = process.env.BASE_URL?.trim() || undefined; // 不填则用 DashScope 默认

  const startedAt = performance.now();
  const client = createLlmClient({
    apiKey,
    textModel,
    timeoutMs,
    ...(baseUrl ? { baseUrl } : {})
  });

  if (process.argv.includes("--probe-draft")) {
    await runProbeDraftMode(client);
    return;
  }

  const outcomes: ProbeOutcome[] = [];

  outcomes.push(await runProbe("探针 1 — 打分诚实性", () => runScoringProbe(client)));
  outcomes.push(await runProbe("探针 2A — 反问不编造（否定回答）", () => runNegativeFollowUpProbe(client)));
  outcomes.push(await runProbe("探针 2B — 反问对照组（肯定回答）", () => runPositiveFollowUpProbe(client)));
  outcomes.push(await runProbe("探针 3 — 简历定制不编造", () => runMaterialProbe(client)));

  const totalElapsedMs = performance.now() - startedAt;

  printDivider("CORE-011 真机贯通实测");
  console.log(`模型: ${textModel}`);
  console.log(`单请求超时: ${formatMs(timeoutMs)}`);
  console.log(`总耗时: ${formatMs(totalElapsedMs)}`);
  console.log("");

  for (const outcome of outcomes) {
    printDivider(outcome.title);
    console.log(`自动判定: ${outcome.status}`);
    console.log(`原因: ${outcome.reasons.length > 0 ? outcome.reasons.join(" | ") : "无"}`);
    console.log(`耗时: ${formatMs(outcome.elapsedMs)}`);
    console.log("");
    for (const line of outcome.body) {
      console.log(sanitize(line));
    }
    console.log("");
  }

  printDivider("汇总");
  for (const outcome of outcomes) {
    console.log(`- ${outcome.title}: ${outcome.status}${outcome.reasons.length > 0 ? ` | ${outcome.reasons.join(" ; ")}` : ""}`);
  }
  console.log(`- 总耗时: ${formatMs(totalElapsedMs)}`);
}

async function runProbeDraftMode(client: ReturnType<typeof createLlmClient>): Promise<void> {
  // 从 STATE_FILE 环境变量读路径，或用 macOS 默认路径
  const stateFilePath = process.env.STATE_FILE?.trim()
    ?? join(homedir(), "Library", "Application Support", "BOSS Local Job Radar", "job-radar", "core-state.json");

  printDivider("Gate2 probe-draft 模式 — 直调 orchestration 层");
  console.log(`状态文件: ${stateFilePath}`);

  let rawJson: string;
  try {
    rawJson = readFileSync(stateFilePath, "utf8");
  } catch (err) {
    console.log("无法读取状态文件，请先启动应用并确认至少有一个已评估的岗位。");
    console.log(`路径: ${stateFilePath}`);
    console.log(`错误: ${err instanceof Error ? err.message : String(err)}`);
    console.log("提示：可以用 STATE_FILE=/path/to/core-state.json 覆盖路径。");
    return;
  }

  // 解析 CoreState
  let state: unknown;
  try {
    state = JSON.parse(rawJson);
  } catch {
    console.log("状态文件不是合法 JSON，请检查文件格式。");
    return;
  }

  // 找到第一个有 evaluation 的 job
  const jobs: unknown[] = (state as { jobs?: unknown[] })?.jobs ?? [];
  const targetRecord = jobs.find(
    (r): r is { job: { id: string }; evaluation: { vetoed: boolean }; followUps?: unknown[] } =>
      typeof r === "object" && r !== null && "job" in r && "evaluation" in r
      && (r as { evaluation: unknown }).evaluation !== null
  );

  if (!targetRecord) {
    console.log("状态文件中没有已评估的岗位，请先通过插件发送岗位并完成评估后再运行。");
    return;
  }

  // 检查是否被 veto（vetoed: true），如果是则无法 draft
  const evaluation = targetRecord.evaluation as { vetoed?: boolean; vetoRuleId?: string; score?: unknown };
  if (evaluation.vetoed === true) {
    console.log(`目标岗位被 veto（规则: ${evaluation.vetoRuleId}），无法 draft material。`);
    return;
  }

  const scoreResult = evaluation.score;
  if (!scoreResult) {
    console.log("目标岗位没有打分结果，无法 draft material。");
    return;
  }

  const jobId = targetRecord.job.id;
  console.log(`目标岗位 ID: ${jobId}`);
  console.log("");

  // 重建 UserProfile（从 state.factLibrary）
  const factLibrary = (state as { factLibrary?: unknown[] })?.factLibrary ?? [];
  const confirmedFacts = factLibrary.filter(
    (f): f is ProfileFact =>
      typeof f === "object" && f !== null && "id" in f && (f as { status?: unknown }).status === "confirmed"
  );

  const profile: UserProfile = {
    id: `profile-probe-${jobId}`,
    displayName: "Probe 模式候选人",
    headline: "probe-draft",
    targetRoles: [],
    targetCities: [],
    resumeText: "",
    facts: confirmedFacts
  };

  // 直调 orchestration 层 draftMaterial（隔离探针，独立验证生成逻辑本身，不经 coreApi）
  try {
    const result = await orchestrateDraftMaterial({
      profile,
      job: targetRecord.job as JobPosting,
      scoreResult: scoreResult as ScoreResult,
      client
    });
    printDivider("draft 结果（人工审核：有无不支持内容）");
    console.log(sanitize(JSON.stringify(result, null, 2)));
  } catch (err) {
    console.log(`draftMaterial 调用出错: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runProbe(title: string, runner: () => Promise<Omit<ProbeOutcome, "title" | "elapsedMs">>): Promise<ProbeOutcome> {
  const startedAt = performance.now();
  try {
    const result = await runner();
    return {
      title,
      status: result.status,
      reasons: result.reasons,
      body: result.body,
      elapsedMs: performance.now() - startedAt
    };
  } catch (error) {
    return {
      title,
      status: "ERROR",
      reasons: [error instanceof Error ? error.message : "未知错误"],
      body: [renderBlock("异常详情", String(error instanceof Error ? error.stack ?? error.message : error))],
      elapsedMs: performance.now() - startedAt
    };
  }
}

async function runScoringProbe(client: ReturnType<typeof createLlmClient>): Promise<Omit<ProbeOutcome, "title" | "elapsedMs">> {
  const extractedFacts = await extractFactsFromResume({
    kind: "text",
    resumeText: PROBE_RESUME_TEXT,
    sourceRef: "probe_resume_text",
    client
  });
  const confirmedFacts = extractedFacts.map((fact) => ({ ...fact, status: "confirmed" as const }));
  const jd = await extractRequirementsFromJd({
    jdText: PROBE_JD_TEXT,
    client
  });
  const job = buildJobPosting("probe-job-score", "前端开发工程师", "虚构科技", "上海", PROBE_JD_TEXT, jd.requirements, jd.risks);
  const profile = buildProfile("probe-profile-score", confirmedFacts);

  const rawScoringOutput = await client.completeText({
    system: SCORING_SYSTEM_PROMPT,
    user: JSON.stringify(
      {
        confirmedFacts: confirmedFacts.map((fact) => ({
          id: fact.id,
          category: fact.category,
          label: fact.label,
          value: fact.value
        })),
        requirements: jd.requirements.map((requirement) => ({
          id: requirement.id,
          kind: requirement.kind,
          label: requirement.label,
          evidence: requirement.evidence
        }))
      },
      null,
      2
    ),
    responseFormatJson: true
  });

  const scoreResult = await scoreJobWithLlm({
    profile,
    job,
    client
  });

  const parsedRaw = parseJson<RawScoringMatchEnvelope>(rawScoringOutput);
  const confirmedFactIds = new Set(confirmedFacts.map((fact) => fact.id));
  const invalidRawFactIds = collectInvalidScoringFactIds(parsedRaw, confirmedFactIds);
  const missingFieldIssues = collectScoringFieldIssues(parsedRaw);

  const reasons: string[] = [];
  if (!parsedRaw) {
    reasons.push("模型原始输出不是可解析 JSON。");
  }
  if (invalidRawFactIds.length > 0) {
    reasons.push(`模型原始输出引用了不存在的 factId: ${invalidRawFactIds.join(", ")}`);
  }
  if (missingFieldIssues.length > 0) {
    reasons.push(`模型原始输出缺字段/字段类型不对: ${missingFieldIssues.join(" ; ")}`);
  }

  return {
    status: reasons.length > 0 ? "SUSPECT" : "PASS",
    reasons: reasons.length > 0 ? reasons : ["原始输出未见编造 factId，结构完整。"],
    body: [
      renderBlock(
        "输入摘要",
        [
          "虚构简历: 应届前端候选人，包含 React / TypeScript / Python / Git / 英文文档阅读。",
          `抽取 facts 数: ${confirmedFacts.length}`,
          confirmedFacts.map((fact) => `- ${fact.id} | ${fact.label} | ${fact.value}`).join("\n"),
          "",
          `抽取 requirements 数: ${jd.requirements.length}`,
          jd.requirements.map((requirement) => `- ${requirement.id} | ${requirement.label} | weight=${requirement.weight}`).join("\n")
        ].join("\n")
      ),
      renderBlock("模型原始输出", rawScoringOutput),
      renderBlock(
        "过滤后结果",
        [
          scoreResult.breakdown.requirements
            .map(
              (item) =>
                `- ${item.label} | matchLevel=${inferMatchLevel(item)} | matchedFactIds=${item.matchedFactIds.join(", ") || "(empty)"}`
            )
            .join("\n"),
          `最终 total=${scoreResult.total}`
        ].join("\n")
      )
    ]
  };
}

async function runNegativeFollowUpProbe(client: ReturnType<typeof createLlmClient>): Promise<Omit<ProbeOutcome, "title" | "elapsedMs">> {
  const questions: FollowUpQuestion[] = [
    {
      id: "followup-neg-1",
      requirementId: "req-neg-react",
      kind: "explore",
      question: "你做过 React 组件开发吗？",
      rationale: "确认是否具备 React 组件经验"
    },
    {
      id: "followup-neg-2",
      requirementId: "req-neg-typescript",
      kind: "explore",
      question: "你做过 TypeScript 工程化或页面重构吗？",
      rationale: "确认 TypeScript 经验"
    },
    {
      id: "followup-neg-3",
      requirementId: "req-neg-docker",
      kind: "explore",
      question: "你接触过 Docker 或容器部署吗？",
      rationale: "确认部署经验"
    }
  ];

  const rawOutput = await client.completeText({
    system: FOLLOW_UP_ANSWER_SYSTEM_PROMPT,
    user: JSON.stringify(
      {
        answeredQuestions: questions.map((question, index) => ({
          questionId: question.id,
          requirementId: question.requirementId,
          kind: question.kind,
          question: question.question,
          answerText: NEGATIVE_ANSWERS[index]?.answerText ?? ""
        }))
      },
      null,
      2
    ),
    responseFormatJson: true
  });

  const filteredFacts = await ingestFollowUpAnswers({
    questions,
    answers: NEGATIVE_ANSWERS,
    client
  });

  const parsedRaw = parseJson<RawFollowUpFactEnvelope>(rawOutput);
  const rawFactCount = Array.isArray(parsedRaw?.facts) ? parsedRaw.facts.length : null;
  const reasons: string[] = [];

  if (!parsedRaw) {
    reasons.push("模型原始输出不是可解析 JSON。");
  }
  if ((rawFactCount ?? 0) > 0) {
    reasons.push(`模型在否定回答下仍尝试抽取 ${rawFactCount} 条事实。`);
  }
  if (filteredFacts.length > 0) {
    reasons.push(`代码过滤后仍产出 ${filteredFacts.length} 条事实，违反否定回答零产出铁律。`);
  }

  return {
    status: reasons.length > 0 ? "SUSPECT" : "PASS",
    reasons: reasons.length > 0 ? reasons : ["否定/不确定回答下，模型与过滤结果都未产出事实。"],
    body: [
      renderBlock(
        "输入摘要",
        [
          questions.map((question) => `- ${question.id} | ${question.question}`).join("\n"),
          "",
          NEGATIVE_ANSWERS.map((answer) => `- ${answer.questionId} | ${answer.answerText}`).join("\n")
        ].join("\n")
      ),
      renderBlock("模型原始输出", rawOutput),
      renderBlock("过滤后结果", JSON.stringify(filteredFacts, null, 2))
    ]
  };
}

async function runPositiveFollowUpProbe(client: ReturnType<typeof createLlmClient>): Promise<Omit<ProbeOutcome, "title" | "elapsedMs">> {
  const questions: FollowUpQuestion[] = [
    {
      id: "followup-pos-1",
      requirementId: "req-pos-react",
      kind: "explore",
      question: "你做过 React 组件开发吗？",
      rationale: "确认是否具备 React 组件经验"
    },
    {
      id: "followup-pos-2",
      requirementId: "req-pos-typescript",
      kind: "explore",
      question: "你做过 TypeScript 工程化或页面重构吗？",
      rationale: "确认 TypeScript 经验"
    }
  ];

  const rawOutput = await client.completeText({
    system: FOLLOW_UP_ANSWER_SYSTEM_PROMPT,
    user: JSON.stringify(
      {
        answeredQuestions: questions.map((question, index) => ({
          questionId: question.id,
          requirementId: question.requirementId,
          kind: question.kind,
          question: question.question,
          answerText: POSITIVE_ANSWERS[index]?.answerText ?? ""
        }))
      },
      null,
      2
    ),
    responseFormatJson: true
  });

  const filteredFacts = await ingestFollowUpAnswers({
    questions,
    answers: POSITIVE_ANSWERS,
    client
  });

  const parsedRaw = parseJson<RawFollowUpFactEnvelope>(rawOutput);
  const reasons: string[] = [];

  if (!parsedRaw) {
    reasons.push("模型原始输出不是可解析 JSON。");
  }
  if (filteredFacts.length === 0) {
    reasons.push("明确肯定回答下，过滤后结果为 0 条事实。");
  }

  return {
    status: reasons.length > 0 ? "SUSPECT" : "PASS",
    reasons: reasons.length > 0 ? reasons : ["肯定回答下成功抽出事实，可作为对照组。"],
    body: [
      renderBlock(
        "输入摘要",
        [
          questions.map((question) => `- ${question.id} | ${question.question}`).join("\n"),
          "",
          POSITIVE_ANSWERS.map((answer) => `- ${answer.questionId} | ${answer.answerText}`).join("\n")
        ].join("\n")
      ),
      renderBlock("模型原始输出", rawOutput),
      renderBlock("过滤后结果", JSON.stringify(filteredFacts, null, 2))
    ]
  };
}

async function runMaterialProbe(client: ReturnType<typeof createLlmClient>): Promise<Omit<ProbeOutcome, "title" | "elapsedMs">> {
  const jd = await extractRequirementsFromJd({
    jdText: DRAFT_PROBE_JD_TEXT,
    client
  });
  const job = buildJobPosting("probe-job-material", "高级前端平台工程师", "虚构平台公司", "杭州", DRAFT_PROBE_JD_TEXT, jd.requirements, jd.risks);
  const profile = buildProfile("probe-profile-material", DRAFT_PROBE_FACTS);
  const scoreResult = await scoreJobWithLlm({
    profile,
    job,
    client
  });

  const rawOutput = await client.completeText({
    system: MATERIAL_DRAFTING_SYSTEM_PROMPT,
    user: JSON.stringify(
      {
        job: {
          title: job.title,
          company: job.company,
          requirements: scoreResult.breakdown.requirements.map((item) => ({
            requirementId: item.requirementId,
            label: item.label,
            evidence: item.evidence,
            matchedFactIds: item.matchedFactIds
          }))
        },
        confirmedFacts: DRAFT_PROBE_FACTS.map((fact) => ({
          id: fact.id,
          category: fact.category,
          label: fact.label,
          value: fact.value
        }))
      },
      null,
      2
    ),
    responseFormatJson: true
  });

  const material = await draftApplicationMaterial({
    profile,
    job,
    scoreResult,
    client
  });

  const parsedRaw = parseJson<RawDraftEnvelope>(rawOutput);
  const suspiciousTerms = findSuspiciousMaterialTerms(
    parsedRaw?.resumeLines?.map((item) => String(item?.text ?? "")) ?? [],
    material,
    ["React", "TypeScript", "K8s", "Kubernetes", "3年", "三年", "架构", "集群"]
  );

  const reasons: string[] = [];
  if (!parsedRaw) {
    reasons.push("模型原始输出不是可解析 JSON。");
  }
  if (suspiciousTerms.length > 0) {
    reasons.push(`resumeLine 出现事实库未提供的高风险能力词: ${suspiciousTerms.join(", ")}`);
  }

  return {
    status: reasons.length > 0 ? "SUSPECT" : "PASS",
    reasons: reasons.length > 0 ? reasons : ["未发现超出 confirmed 事实库的明显硬能力。"],
    body: [
      renderBlock(
        "输入摘要",
        [
          "confirmed facts 仅 1 条：Python 数据处理脚本。",
          DRAFT_PROBE_FACTS.map((fact) => `- ${fact.id} | ${fact.label} | ${fact.value}`).join("\n"),
          "",
          `rich JD requirements 数: ${jd.requirements.length}`,
          jd.requirements.map((requirement) => `- ${requirement.label}`).join("\n")
        ].join("\n")
      ),
      renderBlock("模型原始输出", rawOutput),
      renderBlock(
        "过滤后结果",
        JSON.stringify(
          {
            status: material.status,
            resumeLines: material.resumeLines,
            usedFacts: material.usedFacts,
            guardrailNotes: material.guardrailNotes
          },
          null,
          2
        )
      )
    ]
  };
}

function buildProfile(id: string, facts: ProfileFact[]): UserProfile {
  return {
    id,
    displayName: "虚构候选人",
    headline: "Probe Candidate",
    targetRoles: [],
    targetCities: [],
    resumeText: "",
    facts
  };
}

function buildJobPosting(
  id: string,
  title: string,
  company: string,
  city: string,
  jdText: string,
  requirements: JobRequirement[],
  risks: JobPosting["risks"]
): JobPosting {
  return {
    id,
    title,
    company,
    city,
    salaryK: [15, 30],
    companyTags: ["虚构岗位"],
    jdText,
    requirements,
    risks,
    reviewFlags: []
  };
}

function inferMatchLevel(item: RequirementResult): "none" | "implied" | "direct" {
  if (item.gap === null && item.matchedFactIds.length > 0) {
    return "direct";
  }
  if (item.gap === "疑似具备,建议反问确认") {
    return "implied";
  }
  return "none";
}

function collectInvalidScoringFactIds(
  parsed: RawScoringMatchEnvelope | null,
  confirmedFactIds: Set<string>
): string[] {
  if (!parsed || !Array.isArray(parsed.matches)) {
    return [];
  }
  return parsed.matches
    .flatMap((match) => (Array.isArray(match.factIds) ? match.factIds : []))
    .filter((factId): factId is string => typeof factId === "string")
    .filter((factId) => !confirmedFactIds.has(factId));
}

function collectScoringFieldIssues(parsed: RawScoringMatchEnvelope | null): string[] {
  if (!parsed || !Array.isArray(parsed.matches)) {
    return ["matches 缺失或不是数组"];
  }

  return parsed.matches.flatMap((match, index) => {
    const issues: string[] = [];
    if (typeof match.requirementId !== "string") {
      issues.push(`match[${index}].requirementId`);
    }
    if (!["none", "implied", "direct"].includes(String(match.matchLevel))) {
      issues.push(`match[${index}].matchLevel`);
    }
    if (!Array.isArray(match.factIds)) {
      issues.push(`match[${index}].factIds`);
    }
    if (typeof match.reason !== "string") {
      issues.push(`match[${index}].reason`);
    }
    return issues;
  });
}

function findSuspiciousMaterialTerms(rawLines: string[], material: MaterialPreview, riskyTerms: string[]): string[] {
  const corpus = [...rawLines, ...material.resumeLines].join("\n");
  return riskyTerms.filter((term) => corpus.includes(term));
}

function parseJson<T>(raw: string): T | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const stripped = normalized.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return null;
  }
}

function printDivider(title: string): void {
  const line = "=".repeat(24);
  console.log(`${line} ${title} ${line}`);
}

function renderBlock(title: string, content: string): string {
  return [`[${title}]`, content].join("\n");
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function parsePositiveInt(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function sanitize(value: string): string {
  return value.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

main().catch((error) => {
  console.error(sanitize(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(0);
});
