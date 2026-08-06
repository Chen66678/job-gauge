// 诊断专用 · 只读评测 · 不改产品代码
// 目标:live 跑通 evaluateJobFromJd → llmScoring → 岗位反问 这段链路,
// 在真实简历事实库上摸评分链的表现基线 + 扫链路 bug(会不会报错/输出合不合理/有无编造)。
// 不是建正式评测集(那要等用户插件采的真实 JD),JD 为手造样例,覆盖高匹配/低匹配/部分匹配+学历风险三档。
// 范围说明:本轮不设置 setPreferencesFromText,硬否决(hardVeto)路径不会触发,留下一批。
// 跑法:DASHSCOPE_API_KEY=<key> TEXT_MODEL=qwen-plus npx tsx scripts/eval/job-scoring-chain-smoke.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLlmClient } from "../../src/domain/llmClient";
import { createCoreApi } from "../../src/domain/coreApi";
import type { LocalStorageLike } from "../../src/domain/storage";

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

interface JdSample {
  label: string;
  jdText: string;
  jobBase: {
    title: string;
    company: string;
    city: string;
    salaryK: [number, number];
    companyTags: string[];
  };
}

const JD_SAMPLES: JdSample[] = [
  {
    label: "A. 高匹配 · AI Agent产品实习生",
    jobBase: {
      title: "AI Agent 产品实习生",
      company: "某AI创业公司",
      city: "北京",
      salaryK: [5, 9],
      companyTags: ["创业公司", "AI"]
    },
    jdText: [
      "岗位:AI Agent 产品实习生",
      "职责:",
      "1. 参与多智能体(multi-agent)产品的需求梳理与原型设计",
      "2. 使用 AI 工具(如 Claude/Cursor 等)进行快速原型开发与验证,具备独立 vibe build 能力",
      "3. 独立发现用户痛点,设计并验证 AI native 工具方案",
      "4. 撰写产品方法论文档,并有开源/技术分享经验优先",
      "要求:",
      "1. 熟悉至少一种 AI 编程辅助工具,有独立完成过完整项目的经验",
      "2. 有 multi-agent 或 Agent 架构相关的实践或理解",
      "3. 期望候选人常驻北京,能全职实习"
    ].join("\n")
  },
  {
    label: "B. 低匹配 · Java后端工程师(3年经验)",
    jobBase: {
      title: "Java 后端工程师",
      company: "某电商平台",
      city: "上海",
      salaryK: [25, 40],
      companyTags: ["大厂", "电商"]
    },
    jdText: [
      "岗位:Java 后端工程师",
      "职责:",
      "1. 负责高并发交易系统的后端服务开发与维护",
      "2. 设计并优化分布式系统架构,保障系统稳定性",
      "3. 参与数据库分库分表方案设计",
      "要求:",
      "1. 3年以上 Java 后端开发经验,精通 Spring Cloud/Dubbo 等微服务框架",
      "2. 熟悉 MySQL/Redis/Kafka,有高并发系统设计经验",
      "3. 本科及以上学历,计算机相关专业",
      "4. 常驻上海"
    ].join("\n")
  },
  {
    label: "C. 部分匹配+学历风险 · 短视频运营(AI辅助)",
    jobBase: {
      title: "短视频内容运营(AI辅助方向)",
      company: "某文化传媒公司",
      city: "北京",
      salaryK: [6, 10],
      companyTags: ["传媒", "内容"]
    },
    jdText: [
      "岗位:短视频内容运营(AI辅助方向)",
      "职责:",
      "1. 负责短剧/短视频的剪辑与内容生产,日均产出多条素材",
      "2. 探索并使用 AI 剪辑/生成工具提升内容生产效率",
      "3. 参与内容本地化与多语言适配工作",
      "要求:",
      "1. 有短视频剪辑或内容生产相关实习经验,能适应高强度产出节奏",
      "2. 熟悉至少一种 AI 视频/图像生成工具",
      "3. 本科及以上学历",
      "4. 常驻北京"
    ].join("\n")
  }
];

async function main() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.log("请用 DASHSCOPE_API_KEY=... 运行");
    process.exit(0);
  }
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen-plus";
  const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS) || 180_000;
  const client = createLlmClient({ apiKey, textModel, timeoutMs });
  const storage = new MemoryStorage();
  const api = createCoreApi({ client, storage });

  console.log("========== 阶段0 · 抽取真实事实库(文本模式) ==========");
  const resumeText = readFileSync(join(__dirname, "_private", "resume.txt"), "utf8");
  const t0 = Date.now();
  const facts = await api.ingestResume({ kind: "text", resumeText });
  console.log(`抽出 ${facts.length} 条事实,用时 ${Date.now() - t0}ms`);

  // 本轮测评分链,不测简历阶段反问确认流程,直接模拟"用户已确认全部事实"
  api.setFactStatusBatch(facts.map((f) => ({ factId: f.id, status: "confirmed" as const })));
  console.log(`已模拟确认全部 ${facts.length} 条事实\n`);

  for (const sample of JD_SAMPLES) {
    console.log(`\n========== ${sample.label} ==========`);
    const t1 = Date.now();
    let record;
    try {
      record = await api.evaluateJobFromJd({ jdText: sample.jdText, jobBase: sample.jobBase });
    } catch (error) {
      console.log(`[异常] evaluateJobFromJd 抛出未捕获错误:`, sanitize(error instanceof Error ? error.stack ?? error.message : String(error)));
      continue;
    }
    console.log(`评估用时 ${Date.now() - t1}ms`);

    if (record.evaluationError) {
      console.log(`[流程失败] evaluationError = ${record.evaluationError}`);
      continue;
    }

    console.log(`岗位要求条数: ${record.job.requirements.length}, 风险条数: ${record.job.risks.length}`);
    console.log("岗位要求(requirement):");
    for (const req of record.job.requirements) {
      console.log(`  - [${req.kind}] ${req.label} (weight=${req.weight}) 证据: ${req.evidence}`);
    }
    console.log("岗位风险(risk):");
    for (const risk of record.job.risks) {
      console.log(`  - [${risk.severity}] ${risk.label} 证据: ${risk.evidence}`);
    }

    if (!record.evaluation) {
      console.log("[异常] evaluation 为空但无 evaluationError");
      continue;
    }

    if (record.evaluation.vetoed) {
      console.log(`[否决] vetoRule=${record.evaluation.vetoRuleId} (${record.evaluation.vetoRuleLabel})`);
      continue;
    }

    const score = record.evaluation.score;
    console.log(`\n分数: ${score.total} | 策略: ${score.strategy} (${score.strategyLabel})`);
    console.log(`摘要: ${score.summary}`);
    console.log("逐条要求匹配结果:");
    for (const r of score.breakdown.requirements) {
      console.log(
        `  - ${r.label}: score=${r.score}/${r.maxScore}, matchedFactIds=[${r.matchedFactIds.join(", ")}], gap=${r.gap ?? "无"}`
      );
    }
    console.log(`gaps: ${JSON.stringify(score.gaps)}`);
    console.log(`risks: ${JSON.stringify(score.risks)}`);

    // 编造核查:每个 matchedFactId 是否真实存在于 confirmed 事实库
    const confirmedIds = new Set(facts.map((f) => f.id));
    const fabricatedIds = score.breakdown.requirements.flatMap((r) => r.matchedFactIds.filter((id) => !confirmedIds.has(id)));
    if (fabricatedIds.length > 0) {
      console.log(`[红线告警] 出现不在事实库中的 factId: ${JSON.stringify(fabricatedIds)}`);
    } else {
      console.log(`[红线核查] 所有 matchedFactIds 均可在事实库中溯源到,无编造 factId。`);
    }

    console.log("\n岗位反问(follow-up):");
    const t2 = Date.now();
    try {
      const questions = await api.buildFollowUps(record.job.id);
      console.log(`生成 ${questions.length} 个问题,用时 ${Date.now() - t2}ms`);
      for (const q of questions) {
        console.log(`  Q[${q.kind}] (${q.requirementId}): ${q.question}`);
        console.log(`     理由: ${q.rationale}`);
      }
    } catch (error) {
      console.log(`[异常] buildFollowUps 抛出未捕获错误:`, sanitize(error instanceof Error ? error.stack ?? error.message : String(error)));
    }
  }
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(1);
});
