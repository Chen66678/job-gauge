// 改写质量评测集 · 样本生成工具（backlog #7「改写质量」维）
//
// 这个脚本做一件事：用用户本机真实数据（事实库 + 岗位）跑一次材料生成，
// 把机器能测的维度自动填好，把需要人读的维度留 null，输出一份可标注的 JSON
// 到 _private/runs/rq-<timestamp>.json，让用户在自己机器上填完再交回。
//
// 为什么这样设计（§4.2 + §6.2 + backlog #7）：
//   机器能确定性测的（照搬率/厚度比/factId 溯源）用代码做；
//   需要判断"这件事实够不够格支撑这个强度"（越界/过度包装）是语义判断，
//   D025 定为非零容忍但经验测量，机器给不了真值——真值只能用户标（§6.2）。
//
// 维度说明（对应评测集框架 §二/§三）：
//   照搬率（机器）= 逐字/近逐字照搬行数 / 总 resumeLines 行数
//                   判定：line.text ⊆ fact.value 或 fact.value ⊆ line.text（fact.value > 15字）
//                   草案阈值：≤ 10%（待负样本出现后校准）
//   厚度比（机器）= resumeLines 总字符数 / 原简历总字符数（分母固定，不随模型选事实变化）
//                   阈值：待校准（§三「暂不定新地板数字」，当前正样本区间 0.39-0.55）
//   factId 溯源（机器）= 编造 factId 数量（硬线 = 0）
//   越界行数（人工标）= 逐行人读：说大了/拔高了/限定词丢了/强度词叠加
//                       判据：不是"这个词在不在原文"，是"这件事实够不够格用这个强度"
//                       首个真值样本：见 rq-annotation-guide.md §样本1「首创」
//
// 跑法：
//   export DASHSCOPE_API_KEY=<key>
//   cd code && npx tsx scripts/eval/rewrite-quality-eval.ts [jobId前缀]
//
// 输出：_private/runs/rq-<timestamp>.json
// 标注流程：用编辑器打开 json，把每行 annotation 里的 null 填好，交回首席。

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";
import { draftApplicationMaterial } from "../../src/domain/materialDrafting";
import type { JobPosting, ProfileFact, ScoreResult, UserProfile } from "../../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────── 类型定义（标注格式）──────────────

/**
 * 一行简历内容的机器测量 + 人工标注。
 *
 * overreachType 枚举说明（D032 §二·附 + D005 边界）：
 *   scope_expansion    : 范围扩大（"参与" → "负责整个模块"）
 *   role_elevation     : 角色拔高（"协助" → "主导"、"独立完成"）
 *   qualifier_dropped  : 限定词丢失（"课程项目"→"项目"、"原型"丢掉）
 *   strength_stacked   : 强度叠加（把多个普通表达叠成比任一事实更强的印象）
 *
 * ⚠ 不要因为某个词"在不在原文"来判越界。判据只有一条：
 *   这件事实够不够格支撑写进去的这个强度/范围/角色？
 *   （"首创"案例：事实是产品用了三态体系，够格用三态体系，不够格用首创——
 *    因为"首创"是对整个行业的主张，不是对这件事的描述。见 rq-annotation-guide.md）
 */
export interface RqAnnotationLine {
  lineIndex: number;
  text: string;
  factIds: string[];
  /** 为了方便人读直接嵌入相关事实的原文，不用去翻事实库。 */
  referencedFacts: Array<{
    factId: string;
    value: string;
    summary: string | null;
  }>;
  machineFlags: {
    isVerbatimCopy: boolean;
    /** 逐字命中了哪条事实（方便人读验证"命中得对不对"）。 */
    verbatimMatchedFactId?: string;
  };
  annotation: {
    /** null = 未标注。true = 有越界，false = 正常。 */
    overreach: boolean | null;
    overreachType: "scope_expansion" | "role_elevation" | "qualifier_dropped" | "strength_stacked" | null;
    note: string | null;
  };
}

/** 一个完整的评测样本，含机器指标 + 人工标注槽。 */
export interface RqSample {
  sampleId: string;
  generatedAt: string;
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  model: string;
  metrics: {
    totalLines: number;
    verbatimCopyLines: number;
    /** 照搬率 = verbatimCopyLines / totalLines。草案上限 0.10。 */
    verbatimRate: number;
    resumeTextChars: number;
    resumeLineChars: number;
    /** 厚度比 = resumeLineChars / resumeTextChars。阈值待校准。 */
    thicknessRatio: number;
    confirmedFactCount: number;
    usedFactCount: number;
    /** 硬线：长度必须 = 0。任何非空 factId 都代表编造。 */
    fabricatedFactIds: string[];
  };
  greeting: string;
  lines: RqAnnotationLine[];
  /** 样本级人工标注：填完 lines 之后再填这里。 */
  sampleAnnotation: {
    /** 全部行里判为越界的行数，由用户数完 lines 后填入。 */
    overreachLineCount: number | null;
    verbatimRateOk: boolean | null;
    thicknessOk: boolean | null;
    verdict: "pass" | "fail" | "borderline" | null;
    notes: string | null;
  };
}

// ────────────── 工具函数 ──────────────

function sanitize(s: string): string {
  return s.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

/**
 * 逐字/近逐字照搬检测（与 material-rewrite-live.ts 同逻辑，局部定义避免跨文件依赖）。
 * 只是诊断信号，不是越界判据——照搬≠越界，改写了也可能越界。
 */
function isNearVerbatimCopy(
  lineText: string,
  facts: ProfileFact[]
): { copied: boolean; matchedFactId?: string } {
  for (const fact of facts) {
    const value = fact.value.trim();
    if (value.length < 15) {
      continue;
    }
    if (lineText.includes(value) || value.includes(lineText.trim())) {
      return { copied: true, matchedFactId: fact.id };
    }
  }
  return { copied: false };
}

const CORE_STATE_PATH = join(
  homedir(),
  "Library/Application Support/Electron/job-radar/core-state.json"
);
const RESUME_TEXT_PATH = join(__dirname, "_private", "resume.txt");
const RUNS_DIR = join(__dirname, "_private", "runs");

interface CoreStateRaw {
  factLibrary?: ProfileFact[];
  jobs?: Array<{ job: JobPosting; evaluation?: { score: ScoreResult; vetoed: boolean } | null }>;
}

function loadCoreState(): CoreStateRaw {
  if (!existsSync(CORE_STATE_PATH)) {
    console.log(`未找到本机真实数据: ${CORE_STATE_PATH}`);
    console.log("请先在应用里传一次简历并确认事实，再重跑本脚本。");
    process.exit(0);
  }
  return JSON.parse(readFileSync(CORE_STATE_PATH, "utf8")) as CoreStateRaw;
}

function buildProfile(facts: ProfileFact[], resumeText: string): UserProfile {
  return {
    id: "real-user",
    displayName: "",
    headline: "",
    targetRoles: [],
    targetCities: [],
    resumeText,
    facts
  };
}

// ────────────── 主流程 ──────────────

async function main(): Promise<void> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.log("请先 export DASHSCOPE_API_KEY=<你的 key>，再跑本脚本。key 不会被打印或落盘。");
    process.exit(0);
  }
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen-plus";
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS) || 180_000;
  const client = createLlmClient({ apiKey, textModel, timeoutMs });

  // 读真实数据
  const state = loadCoreState();
  const confirmedFacts = (state.factLibrary ?? []).filter((f) => f.status === "confirmed");
  if (confirmedFacts.length === 0) {
    console.log(
      `本机事实库为空或全部未确认（factLibrary.length=${(state.factLibrary ?? []).length}）。`
    );
    console.log("请先在应用里传一次简历并确认事实，再重跑本脚本。");
    process.exit(0);
  }

  if (!existsSync(RESUME_TEXT_PATH)) {
    console.log(`未找到原简历文本: ${RESUME_TEXT_PATH}`);
    console.log("请先放一份原简历到 scripts/eval/_private/resume.txt，再重跑本脚本。");
    process.exit(0);
  }
  const resumeText = readFileSync(RESUME_TEXT_PATH, "utf8");
  const resumeTextChars = resumeText.length;

  const jobFilter = process.argv[2]?.trim();
  const candidateJobs = (state.jobs ?? []).filter(
    (j) =>
      j.evaluation &&
      !j.evaluation.vetoed &&
      j.job.requirements.length > 0 &&
      (!jobFilter || j.job.id.includes(jobFilter))
  );
  if (candidateJobs.length === 0) {
    console.log("没有找到可用的真实岗位记录（需要已评分、未否决、有 requirements）。");
    process.exit(0);
  }
  const target = candidateJobs[0]!;
  console.log(
    `\n========== 改写质量评测 · 样本生成 ==========`
  );
  console.log(`模型：${textModel} ｜ 事实库 confirmed：${confirmedFacts.length} 条`);
  console.log(`目标岗位：${target.job.id} / ${target.job.title} @ ${target.job.company}\n`);

  const profile = buildProfile(confirmedFacts, resumeText);
  const scoreResult = target.evaluation!.score;
  const confirmedFactById = new Map(confirmedFacts.map((f) => [f.id, f]));

  const t0 = Date.now();
  const material = await draftApplicationMaterial({
    profile,
    job: target.job,
    scoreResult,
    client
  });
  console.log(`生成完毕，用时 ${Date.now() - t0}ms，status=${material.status}`);

  // ── 机器指标 ──
  let verbatimCopyLines = 0;
  let resumeLineChars = 0;
  const usedFactIds = new Set<string>();
  const allConfirmedIds = new Set(confirmedFacts.map((f) => f.id));

  const annotationLines: RqAnnotationLine[] = material.resumeLines.map((line, index) => {
    const copyCheck = isNearVerbatimCopy(line.text, confirmedFacts);
    if (copyCheck.copied) {
      verbatimCopyLines += 1;
    }
    resumeLineChars += line.text.length;
    for (const id of line.factIds) {
      usedFactIds.add(id);
    }

    const referencedFacts = line.factIds
      .map((id) => confirmedFactById.get(id))
      .filter((f): f is ProfileFact => Boolean(f))
      .map((f) => ({ factId: f.id, value: f.value, summary: f.summary ?? null }));

    return {
      lineIndex: index + 1,
      text: line.text,
      factIds: line.factIds,
      referencedFacts,
      machineFlags: {
        isVerbatimCopy: copyCheck.copied,
        ...(copyCheck.matchedFactId ? { verbatimMatchedFactId: copyCheck.matchedFactId } : {})
      },
      annotation: {
        overreach: null,
        overreachType: null,
        note: null
      }
    };
  });

  const fabricatedFactIds = material.resumeLines
    .flatMap((l) => l.factIds)
    .filter((id) => !allConfirmedIds.has(id));

  const totalLines = material.resumeLines.length;
  const verbatimRate = totalLines > 0 ? verbatimCopyLines / totalLines : 0;
  const thicknessRatio = resumeTextChars > 0 ? resumeLineChars / resumeTextChars : NaN;

  // ── 控制台摘要（不含 key，不含事实原文，只报指标）──
  console.log(`\n── 机器指标 ──`);
  console.log(
    `照搬率：${verbatimCopyLines}/${totalLines} = ${(verbatimRate * 100).toFixed(1)}%（草案上限 10%）`
  );
  console.log(
    `厚度比：${resumeLineChars}/${resumeTextChars} = ${thicknessRatio.toFixed(2)}（阈值待校准，参考正样本区间 0.39-0.55）`
  );
  console.log(
    `编造 factId：${fabricatedFactIds.length}（硬线 = 0）${fabricatedFactIds.length > 0 ? " ← 红线告警" : ""}`
  );
  console.log(`使用 confirmed 事实：${usedFactIds.size}/${confirmedFacts.length} 条`);
  console.log(`\n── 需人工标注的维度 ──`);
  console.log(
    `越界行数：待你在输出 JSON 里逐行标注 annotation.overreach，填完后数一数 true 的行数，填进 sampleAnnotation.overreachLineCount。`
  );
  console.log(`判据：这件事实够不够格支撑这个强度？（不是"词在不在原文"，见 rq-annotation-guide.md）`);

  // ── 输出 JSON ──
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const sampleId = `rq-${timestamp}`;
  const sample: RqSample = {
    sampleId,
    generatedAt: new Date().toISOString(),
    jobId: target.job.id,
    jobTitle: target.job.title,
    jobCompany: target.job.company,
    model: textModel,
    metrics: {
      totalLines,
      verbatimCopyLines,
      verbatimRate: Number(verbatimRate.toFixed(4)),
      resumeTextChars,
      resumeLineChars,
      thicknessRatio: Number(thicknessRatio.toFixed(4)),
      confirmedFactCount: confirmedFacts.length,
      usedFactCount: usedFactIds.size,
      fabricatedFactIds
    },
    greeting: material.greeting,
    lines: annotationLines,
    sampleAnnotation: {
      overreachLineCount: null,
      verbatimRateOk: null,
      thicknessOk: null,
      verdict: null,
      notes: null
    }
  };

  mkdirSync(RUNS_DIR, { recursive: true });
  const outPath = join(RUNS_DIR, `${sampleId}.json`);
  writeFileSync(outPath, JSON.stringify(sample, null, 2), "utf8");

  console.log(`\n输出：${outPath}`);
  console.log(`\n【下一步】`);
  console.log(
    `1. 打开 ${outPath}`
  );
  console.log(
    `2. 逐行看 lines[].text，对照 lines[].referencedFacts[].value，判断"这件事实够不够格支撑这个强度"`
  );
  console.log(
    `3. 把 annotation.overreach 改成 true（越界）或 false（正常）；如有必要填 overreachType 和 note`
  );
  console.log(
    `4. 填完所有行后，在 sampleAnnotation 里填 overreachLineCount / verbatimRateOk / thicknessOk / verdict`
  );
  console.log(`5. 把文件路径/内容贴回首席即可（文件已在 _private/ 下，不会进仓库）`);
  console.log(`\n参考：首个真值样本（「首创」类）→ scripts/eval/rq-annotation-guide.md`);
}

main().catch((error) => {
  console.error(sanitize(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exit(1);
});
