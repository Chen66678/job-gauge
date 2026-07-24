// 评测 harness · 阶段1:真实简历 → 抽取事实 → 简历反问
// 只读评测,不碰产品代码、不碰红线。key 只经 env 传,输出打码。
// 跑法:DASHSCOPE_API_KEY=<key> TEXT_MODEL=qwen3.6-plus npx tsx scripts/eval/resume-baseline.ts
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
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen3.6-plus";
  const visionModel = process.env.VISION_MODEL?.trim() || undefined; // 不填用 client 默认 qwen-vl-max
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS) || 180_000;
  const client = createLlmClient({ apiKey, textModel, visionModel, timeoutMs });

  // 图片模式:RESUME_IMAGE=<png/jpg路径>(可多张逗号分隔,逐张抽取合并) → 走产品 vision 路径
  // 文本模式(默认):读 _private/resume.txt
  const imageEnv = process.env.RESUME_IMAGE?.trim();

  console.log("========== 阶段1a · 简历抽取 ==========");
  const t0 = Date.now();
  let facts;
  if (imageEnv) {
    const paths = imageEnv.split(",").map((p) => p.trim()).filter(Boolean);
    console.log(`图片模式,${paths.length} 张:${paths.join(" / ")}`);
    facts = [];
    for (const p of paths) {
      const mimeType = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const imageBase64 = readFileSync(p).toString("base64");
      const pageFacts = await extractFactsFromResume({ kind: "image", imageBase64, mimeType, client });
      facts.push(...pageFacts);
    }
  } else {
    const resumeText = readFileSync(join(__dirname, "_private", "resume.txt"), "utf8");
    console.log("文本模式:_private/resume.txt");
    facts = await extractFactsFromResume({ kind: "text", resumeText, client });
  }
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
