// 诊断专用 · 只读评测 · 不改产品代码
// 目标：把 v0.3 重排后的【新链路完整顺序】端到端跑一次，覆盖上一任 smoke 脚本
// 明确跳过的一段：简历阶段反问建库（buildResumeFollowUps/applyResumeFollowUpAnswers/
// reevaluateJob，这三个方法是重排时新增的，从没在全链上跑过）。
// 生成+导出（draftMaterial/exportResume）走官方 coreApi 路径，D024 拆除总闸后无需再分离。
//
// 正确顺序（用户 2026-07-24 拍定）：
//   上传简历 → 简历阶段反问(建库) → 确认事实 → 评分 → 岗位追问 → 重评 → 生成 → 导出
//
// 两种模式：
//   MOCK（默认，无需 key）：用假 LLM client 验证链路走位、状态迁移、gate 行为，
//                           不验证内容质量。目的是"证明链不崩、顺序对"。
//   LIVE（给 DASHSCOPE_API_KEY）：真模型跑，摸真实表现。
//
// 跑法：
//   npx tsx scripts/eval/full-chain-smoke.ts
//   DASHSCOPE_API_KEY=<key> TEXT_MODEL=qwen3.6-plus npx tsx scripts/eval/full-chain-smoke.ts
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";
import { createCoreApi } from "../../src/domain/coreApi";
import type { LocalStorageLike } from "../../src/domain/storage";
import type { OpenAiCompatibleLlmClient } from "../../src/domain/llmClient";

const __dirname = dirname(fileURLToPath(import.meta.url));

function sanitize(s: string): string {
  return s.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

class MemoryStorage implements LocalStorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

// ---------- 阶段计分板：任一阶段崩了要能一眼看出卡在哪 ----------
type StageStatus = "PASS" | "FAIL" | "SKIP";
const board: { stage: string; status: StageStatus; note: string }[] = [];
function record(stage: string, status: StageStatus, note = ""): void {
  board.push({ stage, status, note });
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : status === "SKIP" ? "⏭️" : "🚧";
  console.log(`${icon} [${stage}] ${status}${note ? " — " + note : ""}`);
}

const FALLBACK_RESUME = [
  "张三",
  "求职意向：AI 产品实习生 | 期望城市：北京",
  "",
  "项目经历",
  "独立开发过一个本地优先的 AI 工具，跑通了从数据结构化到打分的完整链路",
  "沉淀过一份多智能体协作的方法论文档，并开源到 GitHub",
  "",
  "实习经历",
  "某传媒公司 | AI 工作流实习生 | 2026.06-至今",
  "把模糊需求拆成可运行系统，两周内完成四轮迭代"
].join("\n");

const JD_SAMPLE = {
  jobBase: {
    title: "AI Agent 产品实习生",
    company: "某AI创业公司",
    city: "北京",
    salaryK: [5, 9] as [number, number],
    companyTags: ["创业公司", "AI"]
  },
  jdText: [
    "岗位：AI Agent 产品实习生",
    "职责：",
    "1. 参与多智能体（multi-agent）产品的需求梳理与原型设计",
    "2. 使用 AI 工具进行快速原型开发与验证",
    "3. 独立发现用户痛点，设计并验证 AI native 工具方案",
    "要求：",
    "1. 熟悉至少一种 AI 编程辅助工具，有独立完成过完整项目的经验",
    "2. 有 multi-agent 或 Agent 架构相关的实践或理解",
    "3. 期望候选人常驻北京，能全职实习"
  ].join("\n")
};

// MOCK：不 mock 掉 client 本身，而是注入假 fetch —— 这样请求构造、HTTP 错误映射、
// 响应解析、JSON 抽取全都走真实 llmClient 代码路径，只把网络那一跳换掉。
// 比整体替换 client 更接近真链（能抓到解析层的 bug）。
function createMockFetch(getFactIds: () => string[]): typeof fetch {
  let factSeq = 0;
  let scoringRound = 0;
  const reply = (content: string): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  return (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    // 用 system prompt 首行做互斥判据。
    // ⚠ 不能用宽松关键字：llmScoring 的首行里也含 "job requirements"，
    // 会被 jdExtraction 分支先吃掉（这个坑真踩过一次，别改回去）。
    const body = typeof init?.body === "string" ? init.body : "";
    let sysFirstLine = "";
    try {
      sysFirstLine = String(JSON.parse(body)?.messages?.[0]?.content ?? "").split("\n")[0];
    } catch {
      sysFirstLine = "";
    }
    const isStage = (marker: string): boolean => sysFirstLine.includes(marker);
    const wants = (...keys: string[]): boolean => keys.every((k) => body.includes(k));

    // ① 简历抽取
    if (isStage("You extract resume facts")) {
      return reply(
        JSON.stringify({
          facts: [
            { category: "skill", label: "AI编程工具", value: "常用 Codex、Claude、Cursor 等 AI 编程工具", confidence: 0.9 },
            { category: "project", label: "多智能体方法论", value: "沉淀 1200+ 行 AI Agent Team 架构方法论并开源", confidence: 0.85 },
            { category: "project", label: "本地求职工作台", value: "独立设计本地 AI 求职决策工作台，核心链条已跑通", confidence: 0.85 }
          ]
        })
      );
    }
    // ② JD 抽取
    if (isStage("You extract structured job requirements")) {
      return reply(
        JSON.stringify({
          requirements: [
            { kind: "skill", label: "熟悉 AI 编程辅助工具", evidence: "要求1", weight: 0.9 },
            { kind: "experience", label: "multi-agent 实践或理解", evidence: "要求2", weight: 0.8 },
            { kind: "preference", label: "常驻北京全职实习", evidence: "要求3", weight: 0.6 }
          ],
          risks: []
        })
      );
    }
    // ③ 语义匹配评分（LLM 只判 matchLevel + 引 factId，分数本地算，禁止 LLM 出数字）
    if (isStage("You perform semantic matching")) {
      const user = (() => {
        try {
          return String(JSON.parse(body)?.messages?.[1]?.content ?? "");
        } catch {
          return "";
        }
      })();
      const reqIds = [...new Set(Array.from(user.matchAll(/req-[^\s"',\]}]+/g)).map((m) => m[0]))];
      const factIds = [...new Set(Array.from(user.matchAll(/fact-[^\s"',\]}]+/g)).map((m) => m[0]))];
      const usable = factIds.length > 0 ? factIds : getFactIds();
      // 故意给最后一条要求判 none（留一个 gap）——否则全 direct 就没有追问，
      // 阶段6/7 的"追问→补事实→重评分数变化"这条路径等于没验到。
      // 第二轮评分（reevaluateJob 之后事实库变多）时才全给 direct，让分数真的往上动。
      scoringRound += 1;
      const leaveGapAt = scoringRound > 1 ? -1 : reqIds.length - 1;
      return reply(
        JSON.stringify({
          matches: (reqIds.length > 0 ? reqIds : []).map((rid, i) => {
            const isGap = i === leaveGapAt || usable.length === 0;
            return {
              requirementId: rid,
              matchLevel: isGap ? "none" : "direct",
              factIds: isGap ? [] : [usable[i % usable.length]],
              reason: isGap ? "mock 判定：确认事实中没有支撑该要求的证据" : "mock 判定：确认事实直接支撑该要求"
            };
          })
        })
      );
    }
    // ④ 简历阶段反问出题
    if (isStage("You generate follow-up questions to refine")) {
      return reply(
        JSON.stringify({
          questions: [
            { kind: "probe", question: "你用过哪些 AI 编程工具，做到什么程度？", rationale: "简历提到但没写深度" },
            { kind: "explore", question: "那份多智能体方法论是你独立完成的吗？", rationale: "确认主导程度" }
          ]
        })
      );
    }
    // ⑤ 岗位追问出题
    // ⚠ 同 ⑥：questions 里必须带真实 requirementId，否则 followUp.ts:120 丢弃。
    if (isStage("You generate follow-up questions for missing job-match evidence")) {
      const user = (() => {
        try {
          return String(JSON.parse(body)?.messages?.[1]?.content ?? "");
        } catch {
          return "";
        }
      })();
      const gapReqIds = [...new Set(Array.from(user.matchAll(/req-[^\s"',\]}]+/g)).map((m) => m[0]))];
      if (gapReqIds.length === 0) {
        console.log("   ⚠ [mock] 岗位追问请求里没捞到 requirementId");
        return reply(JSON.stringify({ questions: [] }));
      }
      return reply(
        JSON.stringify({
          questions: gapReqIds.map((rid) => ({
            requirementId: rid,
            kind: "probe",
            question: "你能全职实习吗，能常驻北京吗？",
            rationale: "岗位要求常驻北京全职，事实库里没有对应证据"
          }))
        })
      );
    }
    // ⑥ 从反问答案里抽事实
    // ⚠ 必须带 fromQuestionId，且值要是真实问题 id ——
    // 溯源不到问题的事实会被 followUp.ts:226 直接丢弃（fail-closed，正确行为）。
    if (isStage("You extract user-confirmed ability facts")) {
      const user = (() => {
        try {
          return String(JSON.parse(body)?.messages?.[1]?.content ?? "");
        } catch {
          return "";
        }
      })();
      const qIds = [...new Set(Array.from(user.matchAll(/"questionId":\s*"([^"]+)"/g)).map((m) => m[1]))];
      if (qIds.length === 0) {
        console.log("   ⚠ [mock] 反问答案请求里没捞到 questionId");
        return reply(JSON.stringify({ facts: [] }));
      }
      return reply(
        JSON.stringify({
          facts: qIds.map((qid, i) => {
            factSeq += 1;
            return {
              category: "job_search",
              label: `反问补全${factSeq}`,
              value: `用户答复补充的事实 ${factSeq}：这块独立负责，约两周完成`,
              confidence: 0.9,
              fromQuestionId: qid
            };
          })
        })
      );
    }
    // ⑦ 材料生成
    if (isStage("You draft tailored application materials")) {
      const ids = getFactIds();
      return reply(
        JSON.stringify({
          greeting: "您好，我看到这个 AI Agent 产品实习岗位，想投递。",
          resumeLines: [
            { text: "常用 Codex、Claude、Cursor 等 AI 编程工具", factIds: ids.slice(0, 1) },
            { text: "沉淀 1200+ 行 AI Agent Team 架构方法论并开源", factIds: ids.slice(1, 2) },
            { text: "独立设计本地 AI 求职决策工作台，核心链条已跑通", factIds: ids.slice(2, 3) }
          ]
        })
      );
    }
    // ⑧ 偏好解析
    if (isStage("You parse job preference text")) {
      return reply(
        JSON.stringify({
          soft: { targetCities: ["北京"], minSalaryK: 5, preferCompanyTags: [], excludedKeywords: [], riskSensitivity: "mild" },
          veto: []
        })
      );
    }
    if (wants("unmatched-stage-fallback")) {
      return reply("{}");
    }
    console.log(`   ⚠ [mock] 未识别的 prompt 首行，回空 json：${sysFirstLine.slice(0, 70)}`);
    return reply("{}");
  }) as unknown as typeof fetch;
}

// mock fetch 与 coreApi 互相依赖，用一个可后填的间接层解开循环
let factIdProvider: () => string[] = () => [];

async function main(): Promise<void> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  const isLive = apiKey.length > 0;
  const mode = isLive ? "LIVE（真模型）" : "MOCK（假 client，只验链路走位）";
  console.log("=".repeat(70));
  console.log(`v0.3 新链路全链 smoke · 模式 = ${mode}`);
  console.log("=".repeat(70));

  const client = isLive
    ? createLlmClient({
        apiKey,
        textModel: process.env.TEXT_MODEL?.trim() || "qwen3.6-plus",
        timeoutMs: Number(process.env.PROBE_TIMEOUT_MS) || 180_000
      })
    : createLlmClient({
        apiKey: "mock-key-not-a-real-secret",
        fetchImpl: createMockFetch(() => factIdProvider())
      });

  const storage = new MemoryStorage();
  const api = createCoreApi({ client, storage });
  // mock fetch 需要回读当前事实库的真实 id（闭环回填）
  factIdProvider = () => api.getState().factLibrary.filter((f) => f.status === "confirmed").map((f) => f.id);

  // ---------- 阶段1：上传简历 ----------
  const privateResume = join(__dirname, "_private", "resume.txt");
  const resumeText = existsSync(privateResume) ? readFileSync(privateResume, "utf8") : FALLBACK_RESUME;
  console.log(
    `\n---------- 阶段1 · 上传简历（来源：${existsSync(privateResume) ? "_private/resume.txt" : "内置兜底样本"}）----------`
  );
  let extracted;
  try {
    const t = Date.now();
    extracted = await api.ingestResume({ kind: "text", resumeText });
    record("1.上传简历→抽取", "PASS", `抽出 ${extracted.length} 条，${Date.now() - t}ms`);
  } catch (error) {
    record("1.上传简历→抽取", "FAIL", sanitize(error instanceof Error ? error.message : String(error)));
    return summary();
  }
  const unconfirmedCount = api.getState().factLibrary.filter((f) => f.status === "unconfirmed").length;
  console.log(`   抽取后状态：unconfirmed=${unconfirmedCount}（应等于抽取条数，全部待确认）`);

  // ---------- 阶段2：简历阶段反问（建库）----------
  console.log("\n---------- 阶段2 · 简历阶段反问（新增方法，从没在全链跑过）----------");
  let resumeQuestions;
  try {
    const t = Date.now();
    resumeQuestions = await api.buildResumeFollowUps();
    record("2.简历阶段反问", "PASS", `生成 ${resumeQuestions.length} 问，${Date.now() - t}ms`);
    for (const q of resumeQuestions) {
      console.log(`   Q[${q.kind}] ${q.question}`);
      console.log(`      理由：${q.rationale}  requirementId=${q.requirementId}`);
    }
  } catch (error) {
    record("2.简历阶段反问", "FAIL", sanitize(error instanceof Error ? error.message : String(error)));
    return summary();
  }

  // ---------- 阶段3：回答反问 → 事实进库 ----------
  console.log("\n---------- 阶段3 · 回答简历反问 → 新事实进库 ----------");
  if (resumeQuestions.length === 0) {
    record("3.应用反问答案", "SKIP", "上一步没生成问题，无可回答");
  } else {
    try {
      const t = Date.now();
      const answers = resumeQuestions.map((q) => ({
        questionId: q.id,
        answerText: "是的，这块是我独立做的，从头到尾我一个人推的，大概花了两周。"
      }));
      const newFacts = await api.applyResumeFollowUpAnswers(resumeQuestions, answers);
      record("3.应用反问答案", "PASS", `新增 ${newFacts.length} 条事实，${Date.now() - t}ms`);
    } catch (error) {
      record("3.应用反问答案", "FAIL", sanitize(error instanceof Error ? error.message : String(error)));
      return summary();
    }
  }

  // ---------- 阶段4：用户确认事实 ----------
  console.log("\n---------- 阶段4 · 确认事实（模拟用户在 UI 上逐条点确认）----------");
  const allFacts = api.getState().factLibrary;
  api.setFactStatusBatch(allFacts.map((f) => ({ factId: f.id, status: "confirmed" as const })));
  const confirmedCount = api.getState().factLibrary.filter((f) => f.status === "confirmed").length;
  record("4.确认事实", confirmedCount === allFacts.length ? "PASS" : "FAIL", `confirmed=${confirmedCount}/${allFacts.length}`);

  // ---------- 阶段5：评分（此时事实库已建好，confirmed>0）----------
  console.log("\n---------- 阶段5 · 评分（关键：这次是先建库后评分，confirmed 应 >0）----------");
  let jobRecord;
  try {
    const t = Date.now();
    jobRecord = await api.evaluateJobFromJd({ jdText: JD_SAMPLE.jdText, jobBase: JD_SAMPLE.jobBase });
    if (jobRecord.evaluationError) {
      record("5.评分", "FAIL", `evaluationError=${jobRecord.evaluationError}`);
      return summary();
    }
    if (!jobRecord.evaluation) {
      record("5.评分", "FAIL", "evaluation 为空但无 evaluationError");
      return summary();
    }
    const score = jobRecord.evaluation.score;
    record("5.评分", "PASS", `分数=${score.total} 策略=${score.strategy} ${Date.now() - t}ms`);
    console.log(`   摘要：${score.summary}`);
    for (const r of score.breakdown.requirements) {
      console.log(`   - ${r.label}: ${r.score}/${r.maxScore} matched=[${r.matchedFactIds.join(", ")}] gap=${r.gap ?? "无"}`);
    }
    // 红线核查：matchedFactId 必须能在事实库溯源
    const knownIds = new Set(api.getState().factLibrary.map((f) => f.id));
    const fabricated = score.breakdown.requirements.flatMap((r) => r.matchedFactIds.filter((id) => !knownIds.has(id)));
    record(
      "5b.红线·factId 可溯源",
      fabricated.length === 0 ? "PASS" : "FAIL",
      fabricated.length === 0 ? "无编造 factId" : `出现库外 factId：${JSON.stringify(fabricated)}`
    );
  } catch (error) {
    record("5.评分", "FAIL", sanitize(error instanceof Error ? error.message : String(error)));
    return summary();
  }

  // ---------- 阶段6：岗位追问 ----------
  console.log("\n---------- 阶段6 · 岗位追问 ----------");
  let jobQuestions;
  try {
    const t = Date.now();
    jobQuestions = await api.buildFollowUps(jobRecord.job.id);
    record("6.岗位追问", "PASS", `生成 ${jobQuestions.length} 问，${Date.now() - t}ms`);
  } catch (error) {
    record("6.岗位追问", "FAIL", sanitize(error instanceof Error ? error.message : String(error)));
    jobQuestions = [];
  }

  // ---------- 阶段7：重评（reevaluateJob，新增方法）----------
  console.log("\n---------- 阶段7 · 重评（新增方法，验证确认后分数会更新，不再冻死）----------");
  const scoreBefore = jobRecord.evaluation?.score.total;
  try {
    const t = Date.now();
    if (jobQuestions.length > 0) {
      await api.applyFollowUpAnswers(
        jobRecord.job.id,
        jobQuestions.map((q) => ({ questionId: q.id, answerText: "对，这块我做过，独立负责的。" }))
      );
      const pending = api.getState().factLibrary.filter((f) => f.status === "unconfirmed");
      api.setFactStatusBatch(pending.map((f) => ({ factId: f.id, status: "confirmed" as const })));
    }
    const reevaluated = await api.reevaluateJob(jobRecord.job.id);
    if (!reevaluated) {
      record("7.重评", "FAIL", "reevaluateJob 返回 null");
    } else if (reevaluated.evaluationError) {
      record("7.重评", "FAIL", `evaluationError=${reevaluated.evaluationError}`);
    } else {
      const after = reevaluated.evaluation?.score.total;
      record("7.重评", "PASS", `分数 ${scoreBefore} → ${after}，${Date.now() - t}ms`);
      jobRecord = reevaluated;
    }
  } catch (error) {
    record("7.重评", "FAIL", sanitize(error instanceof Error ? error.message : String(error)));
  }

  // ---------- 阶段8：生成材料（官方路径 api.draftMaterial）----------
  console.log("\n---------- 阶段8 · 生成材料（官方路径 api.draftMaterial）----------");
  const material = await api.draftMaterial(jobRecord.job.id);
  record("8.生成材料·官方路径", material.status === "blocked" ? "FAIL" : "PASS", `status=${material.status}`);
  console.log(`   招呼语：${material.greeting}`);
  for (const line of material.resumeLines) {
    console.log(`   - ${line.text}  ←factIds=[${line.factIds.join(", ")}]`);
  }
  console.log(`   usedFacts=${material.usedFacts.length} blockedFacts=${material.blockedFacts.length}`);
  if (material.guardrailNotes.length > 0) {
    console.log(`   guardrailNotes: ${JSON.stringify(material.guardrailNotes)}`);
  }
  // 红线：简历每行的 factIds 必须能溯源到 confirmed
  const confirmedIds = new Set(api.getState().factLibrary.filter((f) => f.status === "confirmed").map((f) => f.id));
  const badLines = material.resumeLines.filter((line) => line.factIds.some((id) => !confirmedIds.has(id)));
  record(
    "8b.红线·简历行可溯源",
    badLines.length === 0 ? "PASS" : "FAIL",
    badLines.length === 0 ? "所有行的 factIds 均溯源到 confirmed" : `${badLines.length} 行含库外 factId`
  );

  // ---------- 阶段9：导出（官方路径 api.exportResume）----------
  console.log("\n---------- 阶段9 · 导出 ----------");
  const exported = api.exportResume(jobRecord.job.id);
  record("9.导出·官方路径", exported.length > 0 ? "PASS" : "FAIL", `markdown 长度=${exported.length}`);
  if (exported.length > 0) {
    console.log("   ---- markdown 前 15 行 ----");
    console.log(
      exported
        .split("\n")
        .slice(0, 15)
        .map((l) => "   " + l)
        .join("\n")
    );
  }

  summary();
}

function summary(): void {
  console.log("\n" + "=".repeat(70));
  console.log("阶段计分板");
  console.log("=".repeat(70));
  for (const row of board) {
    const icon = row.status === "PASS" ? "✅" : row.status === "FAIL" ? "❌" : row.status === "SKIP" ? "⏭️" : "🚧";
    console.log(`${icon} ${row.stage.padEnd(28)} ${row.status.padEnd(16)} ${row.note}`);
  }
  const fails = board.filter((r) => r.status === "FAIL");
  console.log("-".repeat(70));
  console.log(`FAIL=${fails.length}  PASS=${board.filter((r) => r.status === "PASS").length}`);
  if (fails.length > 0) {
    console.log("\n❌ 链路有真 bug，卡在：" + fails.map((f) => f.stage).join(", "));
  } else {
    console.log("\n✅ 全链通。");
  }
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  summary();
  process.exit(1);
});
