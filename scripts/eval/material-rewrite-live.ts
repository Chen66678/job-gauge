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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";
import { draftApplicationMaterial } from "../../src/domain/materialDrafting";
import type { ProfileFact, JobPosting, ScoreResult, UserProfile } from "../../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

// B 版 prompt（本轮 A/B 对照的唯一变量）：不列规则清单，讲目的——像交给一个会写简历的人。
// 唯一留下的硬约束是"不许无中生有"，只说一次；json 输出形状是为了 factIds 溯源，不是防错清单。
// 机制层（materialDrafting.ts 的逐行溯源/丢弃）完全不变，跟这段文案无关。
const PROMPT_VARIANT_B = [
  "一位朋友把简历和一份 JD 发给你，请你帮他把简历改得更好，投这个岗位。",
  "像一个真正懂行的简历顾问那样去写：把经历组织清楚，突出成果和影响，该合并的合并，该讲清楚的讲清楚——把它写成一份真正专业、充分展开的简历，而不是把事实原样罗列。",
  "唯一必须守住的一条：不能凑不存在的经历、技能、项目、数据、时长、雇主、工具或合作者。写的每一句都要能从下面给你的 confirmed 事实里找到依据。",
  "因为这份简历要能追溯到真实依据，请用 json 返回，每一行都标上它依据的 factIds，形状严格为：",
  '{"greeting":"...","resumeLines":[{"text":"...","factIds":["fact-..."]}]}',
  "confirmed 事实是中文就用中文写，不要翻译成别的语言。",
  "只返回 json，不要markdown，不要多余的话。"
].join("\n");

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

// 厚度地板以原简历为基准（D032 §三：一页不得变半页/两页可精简成一页/本就精简的不得再砍），
// 不是事实库——按岗位相关性筛事实是产品的核心价值（D005），不该被算作"变薄"。
const RESUME_TEXT_PATH = join(__dirname, "_private", "resume.txt");

function loadResumeText(): string {
  if (!existsSync(RESUME_TEXT_PATH)) {
    console.log(`未找到原简历文本: ${RESUME_TEXT_PATH}`);
    console.log("请先放一份原简历到 scripts/eval/_private/resume.txt，再重跑本脚本。");
    process.exit(0);
  }
  return readFileSync(RESUME_TEXT_PATH, "utf8");
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

  const resumeText = loadResumeText();
  const resumeTextChars = resumeText.length;
  console.log(`原简历字符数(厚度地板基准): ${resumeTextChars}\n`);

  const jobFilter = process.argv[2]?.trim();
  const repeats = Number(process.argv[3]) || 5;
  const variant = (process.env.PROMPT_VARIANT?.trim().toUpperCase() || "A") as "A" | "B";
  const systemPrompt = variant === "B" ? PROMPT_VARIANT_B : undefined;
  console.log(`prompt 版本: ${variant}${variant === "B" ? "（目的交底，无规则清单）" : "（生产默认，规则清单）"}\n`);

  const candidateJobs = state.jobs.filter(
    (j) => j.evaluation && !j.evaluation.vetoed && j.job.requirements.length > 0 && (!jobFilter || j.job.id.includes(jobFilter))
  );
  if (candidateJobs.length === 0) {
    console.log("没有找到可用的真实岗位记录（需要已评分、未否决、有 requirements）。");
    process.exit(0);
  }
  const target = candidateJobs[0];
  console.log(`目标岗位: ${target.job.id}\n(reqs=${target.job.requirements.length})\n`);

  const profile = buildProfile(confirmedFacts, resumeText);
  const scoreResult = target.evaluation!.score;

  // 跨轮重合度：如果模型是按岗位相关性选事实（相关性由岗位+事实决定，不随机），
  // 那么每轮选中的 factId 集合应该高度重合；重合度低说明是随机挑，不是有原则的筛选。
  const roundUsedFactIds: Set<string>[] = [];
  // 越界用词统计：不是判据，只是趋势观测——约束变化后这类措辞是变多还是变少。
  // ⚠ 判越界的口径（D032 §二·附）：封顶不封词，判的是"这个人的事实够不够格用这个词"，
  // 不是"这个词字面上有没有出现在原简历/事实里"。命中下面某个词 ≠ 越界，只代表"这里值得回头看一眼事实撑不撑"；
  // 真正的判据永远是人读 + 机制层 factId 溯源，不是字面词匹配（字面词匹配当判据已经在这个项目里错过三次同型：
  // 形式测试误杀专业命名、往词表补词撞 D007、把"独立完成"当越界证据——都是拿"词在不在原文"代替"事实够不够格"）。
  const OVERREACH_WORDS = ["主导", "精通", "资深", "架构设计", "全面负责", "独立完成"];
  const overreachCounts = new Map<string, number>(OVERREACH_WORDS.map((w) => [w, 0]));

  for (let round = 1; round <= repeats; round++) {
    console.log(`\n========== 第 ${round}/${repeats} 次复测 ==========`);
    const t0 = Date.now();
    const material = await draftApplicationMaterial({ profile, job: target.job, scoreResult, client, systemPrompt });
    console.log(`用时 ${Date.now() - t0}ms | status=${material.status}`);
    console.log(`招呼语: ${material.greeting}`);
    console.log(`resumeLines 条数: ${material.resumeLines.length}`);

    let verbatimCount = 0;
    let resumeLineChars = 0;
    const usedFactIds = new Set<string>();
    for (const [i, line] of material.resumeLines.entries()) {
      const copyCheck = isNearVerbatimCopy(line.text, confirmedFacts);
      if (copyCheck.copied) verbatimCount++;
      resumeLineChars += line.text.length;
      line.factIds.forEach((id) => usedFactIds.add(id));
      for (const word of OVERREACH_WORDS) {
        const matches = line.text.split(word).length - 1;
        if (matches > 0) overreachCounts.set(word, (overreachCounts.get(word) ?? 0) + matches);
      }
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

    console.log(
      `[事实使用信号] 用了 ${usedFactIds.size}/${confirmedFacts.length} 条 confirmed 事实: ${[...usedFactIds].sort().join(", ")}`
    );
    roundUsedFactIds.push(usedFactIds);

    // 厚度地板以原简历字符数为分母（D032 §三三档均以原简历为基准），不是事实库总字符数：
    // 按岗位相关性筛掉不相关事实是产品价值（D005 选择与强调），不该被算作"变薄"；
    // 地板要防的是"筛完之后剩下的也没写开"，不是"筛掉了多少"。
    const thicknessRatio = resumeTextChars > 0 ? resumeLineChars / resumeTextChars : NaN;
    console.log(
      `[厚度比信号] resumeLines总字符=${resumeLineChars}, 原简历总字符=${resumeTextChars}, 厚度比=${thicknessRatio.toFixed(2)}`
    );
    if (material.guardrailNotes.length > 0) {
      console.log(`guardrailNotes: ${JSON.stringify(material.guardrailNotes)}`);
    }

    // 完整产物：招呼语+全部 resumeLines 连成一份可通读的简历，不夹诊断标记。
    console.log(`\n[完整产物 第${round}轮]`);
    console.log(material.greeting);
    console.log("");
    for (const line of material.resumeLines) {
      console.log(line.text);
    }
  }

  console.log(`\n========== 越界用词统计（全 ${repeats} 轮合计, prompt=${variant}）==========`);
  for (const word of OVERREACH_WORDS) {
    console.log(`「${word}」: ${overreachCounts.get(word) ?? 0} 次`);
  }

  if (roundUsedFactIds.length > 1) {
    console.log(`\n========== 跨轮 factId 重合度 ==========`);
    for (let i = 0; i < roundUsedFactIds.length; i++) {
      for (let j = i + 1; j < roundUsedFactIds.length; j++) {
        const a = roundUsedFactIds[i];
        const b = roundUsedFactIds[j];
        const intersection = [...a].filter((id) => b.has(id));
        const union = new Set([...a, ...b]);
        const jaccard = union.size > 0 ? intersection.length / union.size : NaN;
        console.log(
          `第${i + 1}轮 ∩ 第${j + 1}轮: 交集=${intersection.length}, 并集=${union.size}, Jaccard=${jaccard.toFixed(2)}`
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
});
