// 诊断专用 · 只读评测 · 不改产品代码
// 目标：验 D022 定的 A 类地板【硬线之一】——「流程失败 100% 告知」（宪法 §4.2 不可静默），
// 外加上一任 smoke 明确留下的缺口：「本轮不设置 setPreferencesFromText，硬否决路径不会触发，留下一批」。
//
// 为什么这批不需要真数据：测的是"坏路径会不会静默"和"否决判定对不对"，
// 与模型输出质量无关，用注入的故障 fetch 就能穷举。
//
// 判据（宪法 §4.2 第四级 + D022 硬线）：
//   流程失败必须 ① 不静默 ② 不假装成功 ③ 有明确可读的告知
//   → 落到代码上 = evaluationError 非 null 且非空，且不得抛未捕获异常、不得留下假的成功态。
//
// 跑法：npx tsx scripts/eval/failure-and-veto-smoke.ts
import { createLlmClient } from "../../src/domain/llmClient";
import { createCoreApi } from "../../src/domain/coreApi";
import type { LocalStorageLike } from "../../src/domain/storage";

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

type Verdict = "PASS" | "FAIL";
const board: { name: string; verdict: Verdict; note: string }[] = [];
function judge(name: string, verdict: Verdict, note: string): void {
  board.push({ name, verdict, note });
  console.log(`${verdict === "PASS" ? "✅" : "❌"} [${name}] ${verdict} — ${note}`);
}

const JOB_BASE = {
  title: "AI Agent 产品实习生",
  company: "某AI创业公司",
  city: "北京",
  salaryK: [5, 9] as [number, number],
  companyTags: ["创业公司", "AI"]
};
const JD_TEXT = "岗位：AI Agent 产品实习生\n要求：熟悉 AI 编程辅助工具，常驻北京";

const okReply = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

const FACTS_JSON = JSON.stringify({
  facts: [{ category: "skill", label: "AI编程工具", value: "常用 Codex、Claude、Cursor", confidence: 0.9 }]
});
const JD_JSON = JSON.stringify({
  requirements: [{ kind: "skill", label: "熟悉 AI 编程辅助工具", evidence: "要求1", weight: 0.9 }],
  risks: []
});

function sysFirst(body: string): string {
  try {
    return String(JSON.parse(body)?.messages?.[0]?.content ?? "").split("\n")[0];
  } catch {
    return "";
  }
}

// 故障注入器：正常回答 resume/JD 抽取，只让指定环节坏掉
type FaultMode = "network" | "timeout" | "http500" | "http401" | "http429" | "malformed_json" | "wrong_shape" | "empty_choices";

function createFaultyFetch(failAt: "resume" | "jd" | "scoring", mode: FaultMode): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : "";
    const first = sysFirst(body);
    const stage =
      first.includes("You extract resume facts")
        ? "resume"
        : first.includes("You extract structured job requirements")
          ? "jd"
          : first.includes("You perform semantic matching")
            ? "scoring"
            : "other";

    if (stage === failAt) {
      switch (mode) {
        case "network":
          throw new TypeError("fetch failed");
        case "timeout": {
          const e = new Error("The operation was aborted.");
          e.name = "AbortError";
          throw e;
        }
        case "http500":
          return new Response("upstream boom", { status: 500 });
        case "http401":
          return new Response("bad key", { status: 401 });
        case "http429":
          return new Response("slow down", { status: 429 });
        case "malformed_json":
          return new Response("this-is-not-json{{{", { status: 200, headers: { "Content-Type": "application/json" } });
        case "wrong_shape":
          return new Response(JSON.stringify({ unexpected: "shape" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        case "empty_choices":
          return new Response(JSON.stringify({ choices: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
      }
    }

    if (stage === "resume") return okReply(FACTS_JSON);
    if (stage === "jd") return okReply(JD_JSON);
    if (stage === "scoring") {
      const user = (() => {
        try {
          return String(JSON.parse(body)?.messages?.[1]?.content ?? "");
        } catch {
          return "";
        }
      })();
      const reqIds = [...new Set(Array.from(user.matchAll(/req-[^\s"',\]}]+/g)).map((m) => m[0]))];
      const factIds = [...new Set(Array.from(user.matchAll(/fact-[^\s"',\]}]+/g)).map((m) => m[0]))];
      return okReply(
        JSON.stringify({
          matches: reqIds.map((rid) => ({
            requirementId: rid,
            matchLevel: factIds.length > 0 ? "direct" : "none",
            factIds: factIds.slice(0, 1),
            reason: "mock"
          }))
        })
      );
    }
    return okReply("{}");
  }) as unknown as typeof fetch;
}

function newApi(fetchImpl: typeof fetch) {
  return createCoreApi({
    client: createLlmClient({ apiKey: "mock-key-not-a-real-secret", fetchImpl, timeoutMs: 5_000 }),
    storage: new MemoryStorage()
  });
}

// ============ A. 评分环节各类故障 → 必须落成 evaluationError，不静默、不假成功 ============
async function testScoringFailures(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("A. 评分环节故障 → 「流程失败 100% 告知」硬线");
  console.log("=".repeat(70));

  const modes: FaultMode[] = ["network", "timeout", "http500", "http401", "http429", "malformed_json", "wrong_shape", "empty_choices"];

  for (const mode of modes) {
    const api = newApi(createFaultyFetch("scoring", mode));
    const facts = await api.ingestResume({ kind: "text", resumeText: "张三\n技能：用过 Codex" });
    api.setFactStatusBatch(facts.map((f) => ({ factId: f.id, status: "confirmed" as const })));

    let threw: string | null = null;
    let record: Awaited<ReturnType<typeof api.evaluateJobFromJd>> | null = null;
    try {
      record = await api.evaluateJobFromJd({ jdText: JD_TEXT, jobBase: JOB_BASE });
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }

    if (threw !== null) {
      judge(`A.评分-${mode}`, "FAIL", `抛出未捕获异常（UI 会白屏/崩）：${threw}`);
      continue;
    }
    const err = record?.evaluationError ?? null;
    const hasEval = record?.evaluation != null;
    if (err && err.trim().length > 0 && !hasEval) {
      judge(`A.评分-${mode}`, "PASS", `告知到位：evaluationError="${err.slice(0, 55)}"，无假成功态`);
    } else if (err && hasEval) {
      judge(`A.评分-${mode}`, "FAIL", `同时有 error 和 evaluation，状态自相矛盾`);
    } else if (!err && hasEval) {
      judge(`A.评分-${mode}`, "FAIL", `静默成功——故障被吞掉，UI 会显示一个假分数`);
    } else {
      judge(`A.评分-${mode}`, "FAIL", `既无 error 也无 evaluation：静默失败，UI 无从告知`);
    }
  }
}

// ============ B. 简历抽取环节故障 → 必须抛可识别错误，不能静默返回空事实库 ============
async function testResumeFailures(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("B. 简历抽取故障 → 不得静默返回空库（否则用户以为传成功了）");
  console.log("=".repeat(70));

  const modes: FaultMode[] = ["network", "timeout", "http401", "http500", "malformed_json", "wrong_shape"];
  for (const mode of modes) {
    const api = newApi(createFaultyFetch("resume", mode));
    let threw: { name: string; code?: string; message: string } | null = null;
    let facts: unknown[] = [];
    try {
      facts = await api.ingestResume({ kind: "text", resumeText: "张三\n技能：用过 Codex" });
    } catch (error) {
      const e = error as { name?: string; code?: string; message?: string };
      threw = { name: e.name ?? "Error", code: e.code, message: e.message ?? String(error) };
    }

    if (threw) {
      // 抛错是可接受的告知方式（UI 侧捕获后显示失败态），但错误必须可识别、可解释
      const identifiable = threw.name === "LlmClientError" && Boolean(threw.code);
      judge(
        `B.简历-${mode}`,
        identifiable ? "PASS" : "FAIL",
        identifiable
          ? `抛可识别错误 code=${threw.code}，UI 可据此显示失败态`
          : `抛出的错误不可识别（name=${threw.name} code=${threw.code ?? "无"}），UI 难以区分"没抽到"和"调用失败"`
      );
    } else {
      judge(
        `B.简历-${mode}`,
        facts.length === 0 ? "FAIL" : "FAIL",
        `未抛错、静默返回 ${facts.length} 条 —— 用户会以为简历传成功了，实际是调用失败`
      );
    }
  }
}

// ============ C. 硬否决路径（上一任明确留下的缺口）============
async function testHardVeto(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("C. 硬否决路径（上一任 smoke 留下的空白）");
  console.log("=".repeat(70));

  // 让偏好解析回一条 city allowlist 规则：只接受北京
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : "";
    const first = sysFirst(body);
    if (first.includes("You parse job preference text")) {
      return okReply(
        JSON.stringify({
          soft: { targetCities: ["北京"], minSalaryK: 5, preferCompanyTags: [], excludedKeywords: [], riskSensitivity: "mild" },
          veto: [
            {
              label: "只考虑北京",
              kind: "city",
              mode: "allowlist",
              matchTerms: ["北京"],
              evidence: "用户明确只看北京"
            }
          ]
        })
      );
    }
    if (first.includes("You extract resume facts")) return okReply(FACTS_JSON);
    if (first.includes("You extract structured job requirements")) return okReply(JD_JSON);
    if (first.includes("You perform semantic matching")) {
      const user = (() => {
        try {
          return String(JSON.parse(body)?.messages?.[1]?.content ?? "");
        } catch {
          return "";
        }
      })();
      const reqIds = [...new Set(Array.from(user.matchAll(/req-[^\s"',\]}]+/g)).map((m) => m[0]))];
      const factIds = [...new Set(Array.from(user.matchAll(/fact-[^\s"',\]}]+/g)).map((m) => m[0]))];
      return okReply(
        JSON.stringify({
          matches: reqIds.map((rid) => ({
            requirementId: rid,
            matchLevel: "direct",
            factIds: factIds.slice(0, 1),
            reason: "mock"
          }))
        })
      );
    }
    return okReply("{}");
  }) as unknown as typeof fetch;

  const api = newApi(fetchImpl);
  const facts = await api.ingestResume({ kind: "text", resumeText: "张三\n技能：用过 Codex" });
  api.setFactStatusBatch(facts.map((f) => ({ factId: f.id, status: "confirmed" as const })));
  const prefs = await api.setPreferencesFromText({ acceptText: "只看北京的 AI 产品实习", vetoText: "非北京不去" });
  judge(
    "C.偏好解析出否决规则",
    prefs.hardVeto.rules.length > 0 ? "PASS" : "FAIL",
    `hardVeto 规则数=${prefs.hardVeto.rules.length}${prefs.hardVeto.rules[0] ? `（${prefs.hardVeto.rules[0].label}）` : ""}`
  );

  // C1：外地岗位 → 应命中否决
  const shanghai = await api.evaluateJobFromJd({
    jdText: JD_TEXT,
    jobBase: { ...JOB_BASE, city: "上海", title: "AI 产品实习生（上海）" }
  });
  const v = shanghai.evaluation;
  judge(
    "C1.外地岗位命中否决",
    v?.vetoed === true ? "PASS" : "FAIL",
    v?.vetoed === true ? `已否决，规则=${v.vetoRuleLabel}，且未浪费一次评分调用` : `未否决（vetoed=${v?.vetoed}），allowlist 没生效`
  );

  // C2：否决后不出追问、不出材料（宪法：命中硬红线不生成材料）
  const vetoedFollowUps = await api.buildFollowUps(shanghai.job.id);
  judge(
    "C2.否决后不出追问",
    vetoedFollowUps.length === 0 ? "PASS" : "FAIL",
    `追问数=${vetoedFollowUps.length}（否决岗位不该再耗模型调用问用户）`
  );

  // C3：本地岗位 → 不应被否决
  const beijing = await api.evaluateJobFromJd({ jdText: JD_TEXT, jobBase: JOB_BASE });
  judge(
    "C3.本地岗位不被误杀",
    beijing.evaluation?.vetoed === false ? "PASS" : "FAIL",
    beijing.evaluation?.vetoed === false
      ? `未否决，分数=${beijing.evaluation.score.total}`
      : `被误杀（allowlist 把符合条件的岗位也否了）`
  );

  // C4：city 为空串（插件抓取常见）→ 不应被 allowlist 误杀，代码注释里专门处理过
  const noCity = await api.evaluateJobFromJd({
    jdText: JD_TEXT,
    jobBase: { ...JOB_BASE, city: "", title: "AI 产品实习生（城市未知）" }
  });
  judge(
    "C4.城市缺失不被误杀",
    noCity.evaluation?.vetoed === false ? "PASS" : "FAIL",
    noCity.evaluation?.vetoed === false
      ? "城市未知时跳过城市规则，符合 preferenceParsing.ts:109 的设计"
      : "城市为空被 allowlist 误杀 —— 插件抓不到城市的岗位会被全灭"
  );
}

async function main(): Promise<void> {
  console.log("A 类地板硬线专项 · 流程失败告知 + 硬否决路径");
  console.log("（不需要真实 key / 真实简历：测的是坏路径行为，与模型输出质量无关）");

  await testScoringFailures();
  await testResumeFailures();
  await testHardVeto();

  console.log("\n" + "=".repeat(70));
  console.log("汇总");
  console.log("=".repeat(70));
  for (const row of board) {
    console.log(`${row.verdict === "PASS" ? "✅" : "❌"} ${row.name.padEnd(26)} ${row.note}`);
  }
  const fails = board.filter((r) => r.verdict === "FAIL");
  console.log("-".repeat(70));
  console.log(`PASS=${board.length - fails.length}  FAIL=${fails.length}`);
  if (fails.length > 0) {
    console.log("\n❌ 未达标项：");
    for (const f of fails) {
      console.log(`   · ${f.name}：${f.note}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
