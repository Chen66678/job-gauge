// 诊断专用 · 只读评测 · 不改产品代码
// 验证 D022-语言漂移扫描批次2 的 3 处新增语言锁约束是否生效:
// preferenceParsing / followUp 答案抽取 / materialDrafting.resumeLines
// (jdExtraction 用 job-scoring-chain-smoke.ts 单独验证,不在此脚本内)
// 注意:materialDrafting 直接调用 domain 层函数,不经 coreApi.draftMaterial;
// 结果只落评测日志,不进入任何产品状态/导出路径。已向首席报备。
// 跑法:DASHSCOPE_API_KEY=<key> TEXT_MODEL=qwen3.6-plus npx tsx scripts/eval/language-lock-verify.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";
import { parsePreferences } from "../../src/domain/preferenceParsing";
import { ingestFollowUpAnswers, type FollowUpQuestion } from "../../src/domain/followUp";
import { draftApplicationMaterial } from "../../src/domain/materialDrafting";
import { extractFactsFromResume } from "../../src/domain/resumeExtraction";
import { extractRequirementsFromJd } from "../../src/domain/jdExtraction";
import { scoreJobWithLlm } from "../../src/domain/llmScoring";
import type { JobPosting, UserProfile } from "../../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

function sanitize(s: string): string {
  return s.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

function hasLatinLetters(s: string): boolean {
  // 粗筛:是否包含大段连续英文字母词(排除常见缩写/工具名误报,只看整句是否明显被译)
  const words = s.match(/[A-Za-z]{4,}/g) ?? [];
  return words.length >= 3;
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

  console.log("========== 验证1 · preferenceParsing 语言稳定性 ==========");
  const acceptText = "我希望去北京或上海,期望薪资至少8K,倾向大公司或知名创业公司";
  const vetoText = "绝不去偏远的三四线城市,不接受要求996的岗位";
  const t0 = Date.now();
  const prefs = await parsePreferences({ acceptText, vetoText, client });
  console.log(`用时 ${Date.now() - t0}ms`);
  console.log(`targetCities: ${JSON.stringify(prefs.preferences.targetCities)}`);
  console.log(`preferCompanyTags: ${JSON.stringify(prefs.preferences.preferCompanyTags)}`);
  console.log(`excludedKeywords: ${JSON.stringify(prefs.preferences.excludedKeywords)}`);
  console.log(`veto rules:`);
  for (const rule of prefs.hardVeto.rules) {
    console.log(`  - [${rule.kind}] ${rule.label} 证据: ${rule.evidence}`);
  }
  const prefStrings = [
    ...prefs.preferences.targetCities,
    ...prefs.preferences.preferCompanyTags,
    ...prefs.preferences.excludedKeywords,
    ...prefs.hardVeto.rules.flatMap((r) => [r.label, r.evidence])
  ];
  const prefDrift = prefStrings.filter(hasLatinLetters);
  console.log(prefDrift.length > 0 ? `[漂移嫌疑] ${JSON.stringify(prefDrift)}` : `[语言核查] 全部保持中文,无漂移嫌疑。`);

  console.log("\n========== 验证2 · followUp 答案抽取语言稳定性 ==========");
  const question: FollowUpQuestion = {
    id: "followup-q-1-test",
    requirementId: "resume-refine",
    kind: "explore",
    question: "你提到的AI Agent工作流实习具体负责哪些环节?",
    rationale: "验证用问题"
  };
  const answerText = "我主要负责设计行业配置机制和内容生产流程的重构,把30到60分钟的流程压缩到分钟级,还用了即梦这个工具做视频相关的验证。";
  const t1 = Date.now();
  const answerFacts = await ingestFollowUpAnswers({
    questions: [question],
    answers: [{ questionId: question.id, answerText }],
    client
  });
  console.log(`用时 ${Date.now() - t1}ms,抽出 ${answerFacts.length} 条事实`);
  for (const f of answerFacts) {
    console.log(`  [${f.category}] ${f.label}: ${f.value} (conf=${f.confidence})`);
  }
  const answerStrings = answerFacts.flatMap((f) => [f.category, f.label, f.value]);
  const answerDrift = answerStrings.filter(hasLatinLetters);
  console.log(answerDrift.length > 0 ? `[漂移嫌疑] ${JSON.stringify(answerDrift)}` : `[语言核查] 全部保持中文,无漂移嫌疑。`);

  console.log("\n========== 验证3 · materialDrafting.resumeLines 语言稳定性 ==========");
  console.log("(直接调用 domain 层函数,不经 coreApi.draftMaterial;结果只落评测日志,不进产品状态/导出路径)");
  const resumeText = readFileSync(join(__dirname, "_private", "resume.txt"), "utf8");
  const facts = (await extractFactsFromResume({ kind: "text", resumeText, client })).map((f) => ({
    ...f,
    status: "confirmed" as const
  }));
  console.log(`抽取并模拟确认 ${facts.length} 条事实`);

  const jdText = [
    "岗位:AI Agent 产品实习生",
    "职责: 参与多智能体产品的需求梳理与原型设计,使用 AI 工具进行快速原型开发",
    "要求: 熟悉至少一种 AI 编程辅助工具,有独立完成过完整项目的经验,常驻北京"
  ].join("\n");
  const { requirements, risks } = await extractRequirementsFromJd({ jdText, client });
  const job: JobPosting = {
    id: "job-test-language-lock",
    title: "AI Agent 产品实习生",
    company: "测试公司",
    city: "北京",
    salaryK: [5, 9],
    companyTags: ["创业公司"],
    jdText,
    requirements,
    risks,
    reviewFlags: [],
    pinned: false,
    workAddress: null,
    sourceUrl: null
  };
  const profile: UserProfile = {
    id: "profile-test",
    displayName: "测试候选人",
    headline: "",
    targetRoles: [],
    targetCities: [],
    resumeText,
    facts
  };
  const t2 = Date.now();
  const score = await scoreJobWithLlm({ profile, job, client });
  console.log(`评分用时 ${Date.now() - t2}ms,分数=${score.total},策略=${score.strategy}`);

  const t3 = Date.now();
  const material = await draftApplicationMaterial({ profile, job, scoreResult: score, client });
  console.log(`材料生成用时 ${Date.now() - t3}ms,状态=${material.status}`);
  console.log(`greeting: ${material.greeting}`);
  console.log(`resumeLines:`);
  for (const line of material.resumeLines) {
    console.log(`  - ${line.text} (factIds=${JSON.stringify(line.factIds)})`);
  }
  const lineDrift = material.resumeLines.map((l) => l.text).filter(hasLatinLetters);
  console.log(lineDrift.length > 0 ? `[漂移嫌疑] ${JSON.stringify(lineDrift)}` : `[语言核查] resumeLines 全部保持中文,无漂移嫌疑。`);
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
});
