// 诊断专用 · 只读评测 · 不改产品代码 · 不落盘用户真实数据到 repo
// 目标：D032 落地后，用用户本机真实事实库 + 真实岗位，直接调 draftApplicationMaterial 摸：
//   1) 是不是还在原文照搬（改写质量，07-24 那轮从未测过这维）
//   2) 有没有出现无中生有（编造=0 硬线）
//   3) factIds 是否仍可溯源到 confirmed fact（机制层没动，理应永远为真）
// 只从用户本机 Electron userData 目录读 core-state.json（只读，从不写回、从不拷进 repo）。
// 若该文件不存在或事实库为空，直接退出并提示"请先在应用里传一次简历"。
//
// 跑法：DASHSCOPE_API_KEY=<key> TEXT_MODEL=qwen3.6-plus npx tsx scripts/eval/material-rewrite-live.ts [jobId前缀] [重复次数]
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLlmClient } from "../../src/domain/llmClient";
import { draftApplicationMaterial } from "../../src/domain/materialDrafting";
import type { ProfileFact, JobPosting, ScoreResult, UserProfile } from "../../src/types";

function sanitize(s: string): string {
  return s.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

const CORE_STATE_PATH = join(
  homedir(),
  "Library/Application Support/Electron/job-radar/core-state.json"
);

interface RealCoreState {
  factLibrary: ProfileFact[];
  jobs: Array<{ job: JobPosting; evaluation?: { score: ScoreResult; vetoed: boolean } | null }>;
}

function loadRealState(): RealCoreState {
  if (!existsSync(CORE_STATE_PATH)) {
    console.log(`未找到本机真实数据: ${CORE_STATE_PATH}`);
    console.log("请先在应用里传一次简历（onboarding 或简历页），再重跑本脚本。");
    process.exit(0);
  }
  const raw = JSON.parse(readFileSync(CORE_STATE_PATH, "utf8"));
  return { factLibrary: raw.factLibrary ?? [], jobs: raw.jobs ?? [] };
}

function buildProfile(facts: ProfileFact[]): UserProfile {
  return {
    id: "real-user",
    displayName: "",
    headline: "",
    targetRoles: [],
    targetCities: [],
    resumeText: "",
    facts
  };
}

// 简单的"逐字复制粘贴"检测：resumeLine.text 是否原样等于（或几乎等于）某条 fact.value 的整段。
// 只用作诊断信号，不是判据本身（判据是人读/D032 §二），用于快速定位"有没有整段照搬"。
function isNearVerbatimCopy(lineText: string, facts: ProfileFact[]): { copied: boolean; matchedFactId?: string } {
  for (const fact of facts) {
    const value = fact.value.trim();
    if (value.length < 15) continue;
    if (lineText.includes(value) || value.includes(lineText.trim())) {
      return { copied: true, matchedFactId: fact.id };
    }
  }
  return { copied: false };
}

async function main() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.log("请用 DASHSCOPE_API_KEY=... 运行");
    process.exit(0);
  }
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen3.6-plus";
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS) || 180_000;
  const client = createLlmClient({ apiKey, textModel, timeoutMs });

  const state = loadRealState();
  const confirmedFacts = state.factLibrary.filter((f) => f.status === "confirmed");
  if (confirmedFacts.length === 0) {
    console.log(`本机事实库为空或全部未确认（factLibrary.length=${state.factLibrary.length}）。`);
    console.log("请先在应用里传一次简历并确认事实，再重跑本脚本。");
    process.exit(0);
  }
  console.log(`真实事实库: 共 ${state.factLibrary.length} 条, confirmed ${confirmedFacts.length} 条\n`);

  const jobFilter = process.argv[2]?.trim();
  const repeats = Number(process.argv[3]) || 5;

  const candidateJobs = state.jobs.filter(
    (j) => j.evaluation && !j.evaluation.vetoed && j.job.requirements.length > 0 && (!jobFilter || j.job.id.includes(jobFilter))
  );
  if (candidateJobs.length === 0) {
    console.log("没有找到可用的真实岗位记录（需要已评分、未否决、有 requirements）。");
    process.exit(0);
  }
  const target = candidateJobs[0];
  console.log(`目标岗位: ${target.job.id}\n(reqs=${target.job.requirements.length})\n`);

  const profile = buildProfile(confirmedFacts);
  const scoreResult = target.evaluation!.score;

  for (let round = 1; round <= repeats; round++) {
    console.log(`\n========== 第 ${round}/${repeats} 次复测 ==========`);
    const t0 = Date.now();
    const material = await draftApplicationMaterial({ profile, job: target.job, scoreResult, client });
    console.log(`用时 ${Date.now() - t0}ms | status=${material.status}`);
    console.log(`招呼语: ${material.greeting}`);
    console.log(`resumeLines 条数: ${material.resumeLines.length}`);

    let verbatimCount = 0;
    for (const [i, line] of material.resumeLines.entries()) {
      const copyCheck = isNearVerbatimCopy(line.text, confirmedFacts);
      if (copyCheck.copied) verbatimCount++;
      console.log(
        `  [${i + 1}] ${copyCheck.copied ? "⚠️逐字/近逐字照搬" : "✅已改写"} factIds=[${line.factIds.join(", ")}]`
      );
      console.log(`      ${line.text}`);
    }

    // 红线核查：factIds 必须能在 confirmed 事实库溯源到
    const confirmedIds = new Set(confirmedFacts.map((f) => f.id));
    const fabricated = material.resumeLines.flatMap((l) => l.factIds.filter((id) => !confirmedIds.has(id)));
    console.log(
      fabricated.length === 0
        ? `[红线核查] 所有 factIds 均可在 confirmed 事实库溯源，无编造 factId。`
        : `[红线告警] 出现库外 factId: ${JSON.stringify(fabricated)}`
    );
    console.log(`[改写质量信号] 逐字/近逐字照搬行数 = ${verbatimCount}/${material.resumeLines.length}`);
    if (material.guardrailNotes.length > 0) {
      console.log(`guardrailNotes: ${JSON.stringify(material.guardrailNotes)}`);
    }
  }
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
});
