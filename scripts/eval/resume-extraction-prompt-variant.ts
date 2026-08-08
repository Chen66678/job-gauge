// 诊断专用 · 不改产品代码 · 只读评测
// 用同一份简历文本,对比"现产品 prompt"vs"显式逐条拆分规则的变体 prompt",
// 验证"合并多条并列职责/指标"是否是召回不稳的根因。
// 跑法:DASHSCOPE_API_KEY=<key> TEXT_MODEL=qwen-plus npx tsx scripts/eval/resume-extraction-prompt-variant.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";

const __dirname = dirname(fileURLToPath(import.meta.url));

function sanitize(s: string): string {
  return s.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_KEY]");
}

// 与 resumeExtraction.ts 的 RESUME_EXTRACTION_SYSTEM_PROMPT 完全一致,作对照基线
const BASELINE_PROMPT = [
  "You extract resume facts into json.",
  "Only extract information that is explicitly stated in the resume or is a strong direct implication from the resume text or image.",
  "Do not invent, guess, embellish, normalize into stronger claims, or fill missing details.",
  "If a fact is unclear, unsupported, contradictory, or absent, leave it out.",
  'Every returned fact is still unconfirmed by the user, so treat every item as pending confirmation.',
  'Return json with exactly this shape: {"facts":[{"category":"...","label":"...","value":"...","confidence":0.0}]}',
  "Confidence means how clearly the fact is supported by the resume itself, not how strong the candidate is.",
  "High confidence only for directly stated facts. Lower confidence for strong direct implications.",
  "Do not return markdown. Do not return prose. Return json only.",
  "If nothing reliable can be extracted, return {\"facts\":[]}."
].join("\n");

// 变体:只加"逐条拆分规则",不改其他任何约束(保留绝不编造等红线不变)
const VARIANT_PROMPT = [
  "You extract resume facts into json.",
  "Only extract information that is explicitly stated in the resume or is a strong direct implication from the resume text or image.",
  "Do not invent, guess, embellish, normalize into stronger claims, or fill missing details.",
  "If a fact is unclear, unsupported, contradictory, or absent, leave it out.",
  'Every returned fact is still unconfirmed by the user, so treat every item as pending confirmation.',
  "GRANULARITY RULE: if a resume section lists multiple bullet points, responsibilities, or achievements under one job/project, extract EACH bullet as its own separate fact item. Never merge two or more bullets into a single fact value. Never summarize multiple bullets into one shorter sentence.",
  "Preserve every quantified metric (numbers, percentages, time durations) and every specific proper noun (tool names, technology names, named mechanisms) exactly as written, each in its own fact if the source bullet contains one.",
  'Return json with exactly this shape: {"facts":[{"category":"...","label":"...","value":"...","confidence":0.0}]}',
  "Confidence means how clearly the fact is supported by the resume itself, not how strong the candidate is.",
  "High confidence only for directly stated facts. Lower confidence for strong direct implications.",
  "Do not return markdown. Do not return prose. Return json only.",
  "If nothing reliable can be extracted, return {\"facts\":[]}."
].join("\n");

async function runOnce(client: ReturnType<typeof createLlmClient>, label: string, systemPrompt: string, resumeText: string) {
  const t0 = Date.now();
  const raw = await client.completeText({
    system: systemPrompt,
    user: `Resume text:\n${resumeText.trim()}`,
    responseFormatJson: true
  });
  const elapsed = Date.now() - t0;
  let count = -1;
  let facts: Array<{ category: unknown; label: unknown; value: unknown; confidence: unknown }> = [];
  try {
    const withoutFence = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    const parsed = JSON.parse(withoutFence);
    facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
    count = facts.length;
  } catch {
    console.log(`[${label}] JSON 解析失败,原始输出前 300 字:`, raw.slice(0, 300));
  }
  console.log(`[${label}] 条数=${count} 用时=${elapsed}ms`);
  for (const f of facts) {
    console.log(`  [${f.category}] ${f.label}: ${f.value} (conf=${f.confidence})`);
  }
  return count;
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
  const resumeText = readFileSync(join(__dirname, "_private", "resume.txt"), "utf8");

  console.log("========== baseline prompt ==========");
  await runOnce(client, "baseline", BASELINE_PROMPT, resumeText);

  console.log("\n========== variant prompt(加逐条拆分规则) ==========");
  await runOnce(client, "variant", VARIANT_PROMPT, resumeText);
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
});
