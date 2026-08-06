// D034 五次复测 · 抽取粒度/分组稳定性
//
// 为什么要跑 5 次（D034:152）：「改完跑 5 次复测看稳定性，单次跑通不算证明」。
// 实证依据：D025 那轮合并规则第一版**第一次跑就把 2 个项目糊成 1 条、3 家公司糊成 1 条**，
// 静态测试全绿照样踩红线。静态测试只能验"规则文案在不在"，验不了"模型照不照办"。
//
// 只读评测：不写产品状态、不碰机制层、不改任何产品代码。
// key 只经 env 读，从不落盘、不打印；异常栈打码后才输出。
//
// 跑法（一条命令跑完 5 次）：
//   export DASHSCOPE_API_KEY=...
//   cd code && npx tsx scripts/eval/d034-granularity-restability.ts
//
// 简历取 scripts/eval/_private/resume.txt（已 gitignore，真实简历不进仓库）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";
import { extractFactsAndGroupsFromResume } from "../../src/domain/resumeExtraction";
import type { ProfileFact, ProfileFactGroup } from "../../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.env.RUNS) || 5;

function sanitize(s: string): string {
  return s.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

/**
 * 从简历原文里认出「不同雇主 / 不同项目」的候选实体，作为红线判据的真值来源。
 * 刻意在运行时从简历里推，不把公司名硬编码进本脚本 —— 真实简历内容不该进仓库。
 * 判据：实习/工作经历段落里，含"公司/有限公司/家办/科技/传媒"等机构后缀的行。
 */
function detectEmployerLines(resumeText: string): string[] {
  const lines = resumeText.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => /实习经历|工作经历|职业经历/.test(line));
  const end = lines.findIndex((line, index) => index > start && start >= 0 && /教育经历|专业技能|项目经历/.test(line));
  const scoped = start >= 0 ? lines.slice(start + 1, end > start ? end : undefined) : lines;
  return scoped.filter((line) => /(有限公司|公司|家办|集团|工作室|研究院)/.test(line) && line.length > 4);
}

/**
 * 同理，认出「不同项目」的候选。
 * 真实简历里项目标题可能没有 | 分隔符（公司才有），而是每个项目用空行分隔、
 * 项目标题就是第一行。所以检测「项目经历段内空行后的第一个非空行」。
 */
function detectProjectLines(resumeText: string): string[] {
  const lines = resumeText.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => /^项目经历/.test(line));
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, index) => index > start && /实习经历|工作经历|教育经历/.test(line));
  const scoped = lines.slice(start + 1, end > start ? end : undefined);

  const titles: string[] = [];
  let lastWasBlank = true; // 初始视为刚过标题，下一非空行是第一个项目
  for (const line of scoped) {
    if (line.length === 0) {
      lastWasBlank = true;
    } else if (lastWasBlank) {
      // 空行后的第一个非空行 = 该项目的标题/首句
      titles.push(line);
      lastWasBlank = false;
    } else {
      lastWasBlank = false;
    }
  }
  return titles;
}

interface RunSnapshot {
  run: number;
  ok: boolean;
  error?: string;
  ms: number;
  factCount: number;
  groupCount: number;
  categories: Record<string, number>;
  groupSizes: Record<string, number>;
  facts: ProfileFact[];
  groups: ProfileFactGroup[];
}

type Verdict = "PASS" | "FAIL" | "WARN";
const findings: { run: number; name: string; verdict: Verdict; note: string }[] = [];
function judge(run: number, name: string, verdict: Verdict, note: string): void {
  findings.push({ run, name, verdict, note });
  const icon = verdict === "PASS" ? "✅" : verdict === "WARN" ? "⚠️ " : "❌";
  console.log(`${icon} [run${run}] [${name}] ${verdict} — ${note}`);
}

/**
 * 红线检查：一条事实的 value 里，是否同时出现了两个不同雇主/不同项目的名字。
 * 这正是 D025 那轮踩的红线形态（3 家公司糊成 1 条）。
 */
function checkNoCrossEntityMerge(run: number, snapshot: RunSnapshot, employers: string[], projects: string[]): void {
  const entities = [...employers, ...projects];
  const nameKeys = entities
    .map((line) => line.split(/[|｜]/)[0]!.trim())
    .filter((name) => name.length >= 4);

  let violations = 0;
  for (const fact of snapshot.facts) {
    const hit = nameKeys.filter((name) => fact.value.includes(name));
    if (hit.length > 1) {
      violations += 1;
      console.log(`   ↳ 同一条事实同时含多个实体：${fact.id} → ${hit.join(" / ")}`);
    }
  }
  judge(
    run,
    "红线·不同实体不得糊成一条",
    violations === 0 ? "PASS" : "FAIL",
    violations === 0 ? `检出 ${nameKeys.length} 个实体名，无一条事实跨实体` : `${violations} 条事实跨实体`
  );

  // 分组侧同一红线：两个不同实体不得共享 groupId
  const groupToEntities = new Map<string, Set<string>>();
  for (const fact of snapshot.facts) {
    if (!fact.groupId) {
      continue;
    }
    const set = groupToEntities.get(fact.groupId) ?? new Set<string>();
    for (const name of nameKeys) {
      if (fact.value.includes(name)) {
        set.add(name);
      }
    }
    groupToEntities.set(fact.groupId, set);
  }
  const badGroups = [...groupToEntities.entries()].filter(([, set]) => set.size > 1);
  judge(
    run,
    "红线·不同实体不得共享分组",
    badGroups.length === 0 ? "PASS" : "FAIL",
    badGroups.length === 0 ? "每个分组只对应一个实体" : badGroups.map(([id, set]) => `${id}:${[...set].join("/")}`).join("; ")
  );
}

/** 规则 B 检查：personal / job_search 各应恰好 1 条；education 每校 1 条。 */
function checkRuleB(run: number, snapshot: RunSnapshot): void {
  for (const category of ["personal", "job_search"]) {
    const count = snapshot.categories[category] ?? 0;
    judge(
      run,
      `规则B·${category} 合成一条`,
      count === 1 ? "PASS" : count === 0 ? "FAIL" : "WARN",
      `实际 ${count} 条`
    );
  }
}

/** 规则 C/D 检查：经历/项目类事实应带 groupId；分组 label 应含完整时间且不缩写公司名。 */
function checkGroupingShape(run: number, snapshot: RunSnapshot): void {
  const jobFacts = snapshot.facts.filter((fact) => /experience|project|实习|项目|经历/.test(fact.category));
  const withoutGroup = jobFacts.filter((fact) => !fact.groupId);
  judge(
    run,
    "规则C·经历/项目事实带分组",
    withoutGroup.length === 0 ? "PASS" : "WARN",
    `${jobFacts.length} 条经历/项目类事实中 ${withoutGroup.length} 条无 groupId`
  );

  const labelsWithoutTime = snapshot.groups.filter((group) => !/\d{4}|\d+年|\d+\.\d+|至今/.test(group.label));
  judge(
    run,
    "规则D·分组 label 含完整时间",
    labelsWithoutTime.length === 0 ? "PASS" : "WARN",
    labelsWithoutTime.length === 0
      ? `${snapshot.groups.length} 个分组 label 均含时间`
      : `无时间的 label：${labelsWithoutTime.map((g) => g.label).join(" | ")}`
  );

  const nonGroupFacts = snapshot.facts.filter((fact) => ["personal", "job_search", "education", "skill"].includes(fact.category));
  const wronglyGrouped = nonGroupFacts.filter((fact) => fact.groupId);
  judge(
    run,
    "规则C·非经历类事实不带分组",
    wronglyGrouped.length === 0 ? "PASS" : "WARN",
    `${wronglyGrouped.length} 条 personal/job_search/education/skill 事实带了 groupId`
  );
}

/** 规则 F 检查：summary 字段存在、且不与 value 等长（摘要不得替代 value）。 */
function checkSummary(run: number, snapshot: RunSnapshot): void {
  const missing = snapshot.facts.filter((fact) => fact.summary === null || fact.summary === "");
  judge(
    run,
    "规则F·summary 已产出",
    missing.length === 0 ? "PASS" : "WARN",
    `${snapshot.facts.length} 条中 ${missing.length} 条无 summary`
  );

  const summaryReplacedValue = snapshot.facts.filter((fact) => fact.summary && fact.summary === fact.value);
  judge(
    run,
    "规则F·summary 不等于 value",
    summaryReplacedValue.length === 0 ? "PASS" : "WARN",
    `${summaryReplacedValue.length} 条 summary 与 value 完全相同`
  );
}

/** 规则 E / D025 检查：value 不得被压缩改写 —— 抽样比对 value 是否能在简历原文里找到实质重叠。 */
function checkWordingPreserved(run: number, snapshot: RunSnapshot, resumeText: string): void {
  const normalizedResume = resumeText.replace(/\s+/g, "");
  const experienceFacts = snapshot.facts.filter((fact) => /experience|project|实习|项目/.test(fact.category));
  const suspicious: string[] = [];
  for (const fact of experienceFacts) {
    const normalizedValue = fact.value.replace(/\s+/g, "");
    // 取 value 中最长的连续 12 字片段，看是否在原文里逐字存在。
    const probe = normalizedValue.slice(0, 12);
    if (probe.length >= 8 && !normalizedResume.includes(probe)) {
      suspicious.push(`${fact.id}: ${fact.value.slice(0, 30)}…`);
    }
  }
  judge(
    run,
    "D025·value 保留原文措辞",
    suspicious.length === 0 ? "PASS" : "WARN",
    suspicious.length === 0
      ? `${experienceFacts.length} 条经历/项目 value 首段均可在原文逐字命中`
      : `疑似改写 ${suspicious.length} 条：${suspicious.join(" ; ")}`
  );
}

async function runOnce(run: number, resumeText: string, client: ReturnType<typeof createLlmClient>): Promise<RunSnapshot> {
  const t0 = Date.now();
  try {
    const result = await extractFactsAndGroupsFromResume({ kind: "text", resumeText, client });
    const categories: Record<string, number> = {};
    for (const fact of result.facts) {
      categories[fact.category] = (categories[fact.category] ?? 0) + 1;
    }
    const groupSizes: Record<string, number> = {};
    for (const fact of result.facts) {
      if (fact.groupId) {
        groupSizes[fact.groupId] = (groupSizes[fact.groupId] ?? 0) + 1;
      }
    }
    return {
      run,
      ok: true,
      ms: Date.now() - t0,
      factCount: result.facts.length,
      groupCount: result.groups.length,
      categories,
      groupSizes,
      facts: result.facts,
      groups: result.groups
    };
  } catch (error) {
    return {
      run,
      ok: false,
      error: sanitize(error instanceof Error ? error.message : String(error)),
      ms: Date.now() - t0,
      factCount: 0,
      groupCount: 0,
      categories: {},
      groupSizes: {},
      facts: [],
      groups: []
    };
  }
}

async function main(): Promise<void> {
  const resumeText = readFileSync(join(__dirname, "_private", "resume.txt"), "utf8");
  const employers = detectEmployerLines(resumeText);
  const projects = detectProjectLines(resumeText);

  // 红线判据的真值是运行时推出来的，所以它本身必须可核 ——
  // 若认出 0 个实体，红线检查会"空过"（没东西可比，永远 PASS），那是假绿。
  // DETECT_ONLY=1 不花额度、不需要 key，专门用来先核这一层认得对不对。
  if (process.env.DETECT_ONLY === "1") {
    console.log("========== 仅核红线真值（不调模型、不需要 key）==========");
    console.log(`雇主候选 ${employers.length} 个：`);
    for (const line of employers) {
      console.log(`  · ${line.split(/[|｜]/)[0]!.trim()}`);
    }
    console.log(`项目候选 ${projects.length} 个：`);
    for (const line of projects) {
      console.log(`  · ${line.split(/[|｜]/)[0]!.trim()}`);
    }
    console.log("");
    console.log("请自己看一眼：上面列出的条数与名字，是否等于你简历里真实的不同雇主/不同项目数。");
    console.log("若为 0 或明显少 → 红线检查会空过，先修 detect 函数再跑五次复测。");
    process.exit(0);
  }

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.log("请先 export DASHSCOPE_API_KEY=<你的 key>，再跑本脚本。key 不会被打印或落盘。");
    console.log("（想先不花额度核一下红线真值认得对不对：DETECT_ONLY=1 npx tsx scripts/eval/d034-granularity-restability.ts）");
    process.exit(0);
  }
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen-plus";
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS) || 180_000;
  const client = createLlmClient({ apiKey, textModel, timeoutMs });

  console.log("========== D034 五次复测 · 抽取粒度与分组稳定性 ==========");
  console.log(`模型：${textModel} ｜ 次数：${RUNS} ｜ 判据：D034:147-153 可重开条件`);
  console.log(`简历里认出的雇主候选 ${employers.length} 个、项目候选 ${projects.length} 个（红线真值，运行时从原文推，不硬编码）`);
  console.log("");

  const snapshots: RunSnapshot[] = [];
  for (let run = 1; run <= RUNS; run += 1) {
    console.log(`---------- 第 ${run}/${RUNS} 次 ----------`);
    const snapshot = await runOnce(run, resumeText, client);
    snapshots.push(snapshot);

    if (!snapshot.ok) {
      // §4.2 流程失败不可静默：跑挂了要明确记一笔，不当成"这次没问题"。
      judge(run, "流程", "FAIL", `抽取失败：${snapshot.error}`);
      console.log("");
      continue;
    }

    console.log(
      `事实 ${snapshot.factCount} 条 ｜ 分组 ${snapshot.groupCount} 个 ｜ 用时 ${snapshot.ms}ms ｜ 分类 ${JSON.stringify(snapshot.categories)}`
    );
    for (const group of snapshot.groups) {
      console.log(`   分组 ${group.id}（${snapshot.groupSizes[group.id] ?? 0} 条子事实）: ${group.label}`);
    }
    checkNoCrossEntityMerge(run, snapshot, employers, projects);
    checkRuleB(run, snapshot);
    checkGroupingShape(run, snapshot);
    checkSummary(run, snapshot);
    checkWordingPreserved(run, snapshot, resumeText);
    console.log("");
  }

  // ---------- 跨次稳定性 ----------
  console.log("========== 跨次稳定性 ==========");
  const okRuns = snapshots.filter((snapshot) => snapshot.ok);
  const factCounts = okRuns.map((snapshot) => snapshot.factCount);
  const groupCounts = okRuns.map((snapshot) => snapshot.groupCount);
  const spread = (values: number[]): number => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values));

  console.log(`成功 ${okRuns.length}/${RUNS} 次`);
  console.log(`事实条数各次：[${factCounts.join(", ")}]  极差 ${spread(factCounts)}`);
  console.log(`分组个数各次：[${groupCounts.join(", ")}]  极差 ${spread(groupCounts)}`);

  const groupCountStable = spread(groupCounts) === 0;
  console.log(
    `${groupCountStable ? "✅" : "❌"} 分组个数稳定性：${groupCountStable ? "5 次完全一致" : "各次不一致 → 粒度判据不稳"}`
  );

  const redlineFails = findings.filter((f) => f.name.startsWith("红线") && f.verdict === "FAIL");
  const processFails = findings.filter((f) => f.name === "流程" && f.verdict === "FAIL");
  const warns = findings.filter((f) => f.verdict === "WARN");

  console.log("");
  console.log("========== 判据结论（贴回给首席用这一段）==========");
  console.log(`红线（不同公司/不同项目糊成一条）：${redlineFails.length === 0 ? "0 次触发 → 未踩" : `${redlineFails.length} 次触发 → 已踩，D034 不过关`}`);
  console.log(`流程失败：${processFails.length} 次`);
  console.log(`分组个数：${groupCountStable ? "稳定" : "不稳定"}（极差 ${spread(groupCounts)}）`);
  console.log(`事实条数极差：${spread(factCounts)}（判据见下方说明，极差本身不单独定成败）`);
  console.log(`WARN 项：${warns.length} 条${warns.length > 0 ? " → " + warns.map((w) => `run${w.run}:${w.name}`).join(", ") : ""}`);
  console.log("");
  console.log("【怎么读这份输出】");
  console.log("1. 红线只有一条硬的：任一次出现「同一条事实/同一个分组跨两个不同雇主或不同项目」= 不过关，回去改判据。");
  console.log("2. 分组个数必须 5 次一致。个数飘 = 模型对「一段经历」的边界认定不稳，正是 D025 那轮踩红线的前兆。");
  console.log("3. 事实条数允许有极差（D034 明确不写死数字、按内容定），但极差 > 该简历经历条目数的一半，视为拆分判据不稳。");
  console.log("4. WARN 不单独判不过关，是给人看的信号（如 summary 缺失、label 少时间）。连续 5 次同一处 WARN = 该处规则没生效，要改。");
  console.log("5. 本脚本只验粒度/分组/措辞保留。「摘要要不要喂给生成」是 D034 另一个待实测项，不在本脚本范围。");

  const hardFail = redlineFails.length > 0 || processFails.length > 0 || !groupCountStable;
  console.log("");
  console.log(`总判据：${hardFail ? "❌ 未过关（见上）" : "✅ 五次均未踩红线且分组稳定"}`);
  console.log("⚠ 本脚本只给证据，不代表 D034 通过 —— 终判权在用户（域一级自审已被 08-05 实证不成立）。");
}

main().catch((error) => {
  console.error(sanitize(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exit(1);
});
