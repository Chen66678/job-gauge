// 评测 harness · 阶段1:真实简历 → 抽取事实 → 简历反问
// 只读评测,不碰产品代码、不碰红线。key 只经 env 传,输出打码。
// 跑法:DASHSCOPE_API_KEY=<key> TEXT_MODEL=qwen-plus npx tsx scripts/eval/resume-baseline.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { extractFactsFromResume } from "../../src/domain/resumeExtraction";
import { generateResumeFollowUpQuestions } from "../../src/domain/followUp";

function sanitize(s: string): string {
  return s.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

async function main() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.log("请用 DASHSCOPE_API_KEY=... 运行");
    process.exit(0);
  }
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen-plus";
  const timeoutMs = process.env.PROBE_TIMEOUT_MS ? Number(process.env.PROBE_TIMEOUT_MS) : undefined;
  const client = createLlmClient({ apiKey, textModel, timeoutMs });

  // D025:图片简历入口已砍,只保留文本模式:读 _private/resume.txt
  console.log("========== 阶段1a · 简历抽取 ==========");
  const t0 = Date.now();
  const resumeText = readFileSync(join(__dirname, "_private", "resume.txt"), "utf8");
  const facts = await extractFactsFromResume({ kind: "text", resumeText, client });
  console.log(`抽出 ${facts.length} 条事实,用时 ${Date.now() - t0}ms\n`);
  for (const f of facts) {
    console.log(`[${f.category}] ${f.label}: ${f.value}  (conf=${f.confidence})`);
  }

  console.log("\n========== 阶段1b · 简历反问 ==========");
  const t1 = Date.now();
  const questions = await generateResumeFollowUpQuestions({ facts, client });
  console.log(`生成 ${questions.length} 个问题,用时 ${Date.now() - t1}ms\n`);
  for (const q of questions) {
    console.log(`Q: ${q.question}`);
    console.log(`   理由: ${q.rationale}\n`);
  }
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
});
