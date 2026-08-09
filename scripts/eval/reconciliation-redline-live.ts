/**
 * 任务① 调和层行为验证（真模型）
 *
 * 验的是 factReconciliation 的红线：**不同雇主 / 不同项目永不得判为同一件事**。
 * 为什么这条最重要：合错不可逆 —— 两段真经历被糊成一条，证据底本就没了（D025 红线、D037:58）。
 * 抽取糊了还能重传，合错了主库已经改。
 *
 * 数据全为合成样本，不用真简历：
 *  - 红线判据需要精确真值（"这两条到底是不是同一件事"），构造样本才控得住；
 *  - 顺带避免把用户简历内容写进仓库。
 *  ⚠ 局限：合成样本有过拟合风险（同 D025 那条"synthetic JD 上调 prompt 会过拟合"），
 *    真实数据上的表现仍需后续用真实事实库复验。
 *
 * 跑法：
 *   set -a && source ./.env.local && set +a
 *   npx tsx scripts/eval/reconciliation-redline-live.ts
 *   可选 RUNS=5 TEXT_MODEL=qwen-plus PROBE_TIMEOUT_MS=<ms>（不设则吃 llmClient 生产默认值）
 */
import { createLlmClient } from "../../src/domain/llmClient";
import { reconcileFactVersions, type FactVersion } from "../../src/domain/factReconciliation";

const RUNS = Number(process.env.RUNS) || 5;

// must_conflict_only 比 should_conflict 严：除了要判 conflict 且进 plan.conflicts，
// 还要求同一对 id 上不得同时出现 merge/supplement。
// 复合记录形态必须用它 —— 那个形态一旦被判 merge，reconstructMergedValue 会拼出用户没写过的经历。
type Expect = "must_not_relate" | "should_relate" | "should_conflict" | "must_conflict_only";

interface Case {
  name: string;
  why: string;
  expect: Expect;
  /** must_not_relate 时：这两个 id 不得出现在同一条 merge/supplement 结论里 */
  pair: [string, string];
  versions: FactVersion[];
}

const V = (
  id: string,
  label: string,
  value: string,
  sourceType: FactVersion["sourceType"] = "resume",
  category = "experience"
): FactVersion => ({ id, category, label, value, sourceType, precedence: 0 });

const CASES: Case[] = [
  {
    name: "红线①·两家不同公司，职责描述高度相似",
    why: "最危险的形态：字面像但实体不同。D025 那轮就是把 3 家公司糊成 1 条",
    expect: "must_not_relate",
    pair: ["c1", "c2"],
    versions: [
      V("c1", "甲元科技有限公司 | AI 工作流实习生", "负责搭建 AI Agent 工作流，用大模型把内容生产流程自动化，落地 3 条流水线"),
      V("c2", "乙泛网络科技有限公司 | AI 工作流实习生", "负责搭建 AI Agent 工作流，用大模型做内容生产自动化，落地 4 条流水线")
    ]
  },
  {
    name: "红线②·两个不同项目，名字只差两个字",
    why: "项目边界比公司更容易被字符串相似度带偏",
    expect: "must_not_relate",
    pair: ["p1", "p2"],
    versions: [
      V("p1", "智能客服系统重构", "重构客服对话系统，把响应延迟从 2s 降到 600ms", "resume", "project"),
      V("p2", "智能客服知识库建设", "搭建客服知识库，覆盖 1200 条问答，准确率 91%", "resume", "project")
    ]
  }
];

CASES.push(
  {
    name: "反向①·同一家公司，简称 vs 全称（该认出是同一件）",
    why: "只测红线会让「一律不合」拿满分 —— 那是 D037 §五#4「往严也是失败」。必须双向测",
    expect: "should_relate",
    pair: ["s1", "s2"],
    versions: [
      V("s1", "甲元科技有限公司 | AI 工作流实习生", "负责搭建 AI Agent 工作流，落地 3 条内容生产流水线"),
      V("s2", "甲元 | AI工作流实习", "在甲元做 AI Agent 工作流，上线了三条内容生产流水线", "user_answer")
    ]
  },
  {
    name: "反向②·同一段经历，对话补出简历没有的量化（该判 supplement）",
    why: "D036 临时仓位归档要走同一套规则，这是那个入口的形态",
    expect: "should_relate",
    pair: ["u1", "u2"],
    versions: [
      V("u1", "丙成信息技术有限公司 | 后端开发", "负责订单服务的接口开发与维护"),
      V("u2", "丙成信息技术有限公司 | 后端开发", "订单服务接口，日均调用 80 万次，我一个人维护", "user_answer")
    ]
  },
  {
    name: "反向③·手动录入 vs 简历，同一段（三来源同判据）",
    why: "D037 判据层要求三种来源同判据，manual 这一路不能漏",
    expect: "should_relate",
    pair: ["m1", "m2"],
    versions: [
      V("m1", "丁华数据服务有限公司 | 数据分析", "做用户行为分析报表"),
      V("m2", "丁华数据服务有限公司 | 数据分析师", "用户行为分析，产出周报与转化漏斗", "manual")
    ]
  },
  {
    name: "冲突·同一段经历但时长互相矛盾（该进 conflicts，不自动裁决）",
    why: "D036 §四归档冲突是用户明确的开放项，模块不许自己焊死替换/两存",
    expect: "should_conflict",
    pair: ["x1", "x2"],
    versions: [
      V("x1", "戊安传媒有限公司 | 视频剪辑", "视频剪辑，2024.03-2024.09，共 7 个月"),
      V("x2", "戊安传媒有限公司 | 视频剪辑", "视频剪辑，做了将近两年", "user_answer")
    ]
  },
  {
    name: "复合记录·合并版 vs 它的成分（该判 conflict，不许 merge）",
    why: "用户第三枪真机形态：两份简历对同一段时期，一份合写、一份拆写。合并版雇主字段自带两个实体，旧规则会正确地拒绝关联 → 库里留两版认不出。只许 conflict：谁为准归用户（D036 §四），merge 会拼出用户没写过的经历",
    expect: "must_conflict_only",
    pair: ["k1", "k2"],
    versions: [
      V("k1", "幺米泛游／枫叶互动 | 剪辑与本地化实习生 | 2025.05-2026.01", "负责短剧素材剪辑与海外本地化，覆盖多语言字幕与 AI 协作流程"),
      V("k2", "北京枫叶互动科技有限公司 | 视频剪辑 | 2025.05-2025.10", "负责海外热门短剧的多语言本地化剪辑")
    ]
  },
  {
    name: "红线③·复合记录 vs 完全无关的第三家（仍须不关联）",
    why: "防止新规则被过度触发：合并版里没提到的公司，不因为『那条含多个实体』就被卷进来。这条守的是新规则的窄口径本身",
    expect: "must_not_relate",
    pair: ["k1b", "k3"],
    versions: [
      V("k1b", "幺米泛游／枫叶互动 | 剪辑与本地化实习生 | 2025.05-2026.01", "负责短剧素材剪辑与海外本地化，覆盖多语言字幕与 AI 协作流程"),
      V("k3", "己诚文化传播有限公司 | 视频剪辑", "负责短剧素材剪辑与海外本地化，多语言字幕产出")
    ]
  }
);

interface Outcome {
  ok: boolean;
  hard: boolean; // true=红线级失败
  detail: string;
}

function judge(c: Case, plan: Awaited<ReturnType<typeof reconcileFactVersions>>): Outcome {
  if (plan.unusable) {
    // fail-closed 不算红线破：它没合错，只是没合。但要如实记。
    return { ok: false, hard: false, detail: `unusable（${plan.unusableReason ?? "未给原因"}）—— 未合错，但也没结论` };
  }
  const [a, b] = c.pair;
  const related = plan.items.filter(
    (i) => i.versionIds.includes(a) && i.versionIds.includes(b) && (i.verdict === "merge" || i.verdict === "supplement")
  );
  const conflicted = plan.items.filter(
    (i) => i.versionIds.includes(a) && i.versionIds.includes(b) && i.verdict === "conflict"
  );

  if (c.expect === "must_not_relate") {
    if (related.length > 0) {
      return { ok: false, hard: true, detail: `🔴 破红线：判为 ${related[0]!.verdict} —— ${related[0]!.rationale.slice(0, 80)}` };
    }
    return { ok: true, hard: false, detail: "未关联（正确）" };
  }

  if (c.expect === "should_relate") {
    if (related.length > 0) {
      const it = related[0]!;
      // 合并 value 必须是代码从原文重建的，不能是模型写的句子
      const srcs = c.versions.filter((v) => it.versionIds.includes(v.id)).map((v) => v.value);
      const traceable = it.mergedValue ? srcs.some((s) => it.mergedValue!.includes(s.trim())) : false;
      if (it.mergedValue && !traceable) {
        return { ok: false, hard: true, detail: `🔴 mergedValue 不含任何原文段，疑似模型改写：${it.mergedValue.slice(0, 60)}` };
      }
      return { ok: true, hard: false, detail: `判为 ${it.verdict}（正确）` };
    }
    return { ok: false, hard: false, detail: "漏合（软失败：该认出是同一件却没认出，D037 往严侧代价）" };
  }

  if (c.expect === "must_conflict_only") {
    // 先查有没有被判成关联 —— 这是这个形态最危险的失败：merge 会让代码拼接两段原文，
    // 产出用户从没写过的经历（比"没认出"严重得多，且不可逆）。
    if (related.length > 0) {
      return {
        ok: false,
        hard: true,
        detail: `🔴 复合记录被判 ${related[0]!.verdict} —— 会拼出用户没写过的经历：${related[0]!.mergedValue?.slice(0, 60) ?? "(无 mergedValue)"}`
      };
    }
    if (conflicted.length === 0) {
      return { ok: false, hard: false, detail: "没认出是同一段历史的两种写法（软失败：库里会留两版）" };
    }
    if (!plan.conflicts.some((i) => i.versionIds.includes(a) && i.versionIds.includes(b))) {
      return { ok: false, hard: true, detail: "🔴 判了 conflict 但没进 plan.conflicts —— 上层拿不到，等于自动裁决" };
    }
    // conflict 项不该带 mergedValue（带了说明代码侧也拼了）
    if (conflicted.some((i) => i.mergedValue)) {
      return { ok: false, hard: true, detail: "🔴 conflict 项带了 mergedValue —— 冲突不该产出合并文本" };
    }
    return { ok: true, hard: false, detail: "判 conflict、已进 conflicts、无 mergedValue（正确）" };
  }

  // should_conflict
  if (conflicted.length === 0) {
    if (related.length > 0) {
      return { ok: false, hard: true, detail: `🔴 矛盾内容被判 ${related[0]!.verdict} 而非 conflict —— 会静默合掉一个真值` };
    }
    return { ok: false, hard: false, detail: "既没判 conflict 也没判关联（软失败）" };
  }
  const inConflicts = plan.conflicts.some((i) => i.versionIds.includes(a) && i.versionIds.includes(b));
  if (!inConflicts) {
    return { ok: false, hard: true, detail: "🔴 判了 conflict 但没进 plan.conflicts —— 上层拿不到，等于自动裁决" };
  }
  return { ok: true, hard: false, detail: "判 conflict 且已进 conflicts（正确）" };
}

async function main(): Promise<void> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.log("请先 set -a && source ./.env.local && set +a");
    process.exit(0);
  }
  const textModel = process.env.TEXT_MODEL?.trim() || "qwen-plus";
  const timeoutMs = process.env.PROBE_TIMEOUT_MS ? Number(process.env.PROBE_TIMEOUT_MS) : undefined;
  const client = createLlmClient({ apiKey, textModel, timeoutMs });

  console.log("========== 任务① 调和层红线验证（真模型）==========");
  console.log(`模型：${textModel} ｜ 每例跑 ${RUNS} 次 ｜ 合成样本（非真简历）`);
  console.log(`红线：不同雇主/不同项目不得判为同一件事（合错不可逆，D025/D037:58）`);
  console.log("");

  const tally = new Map<string, { pass: number; hard: number; soft: number; details: string[] }>();
  for (const c of CASES) tally.set(c.name, { pass: 0, hard: 0, soft: 0, details: [] });

  for (let run = 1; run <= RUNS; run++) {
    console.log(`---------- 第 ${run}/${RUNS} 轮 ----------`);
    for (const c of CASES) {
      let out: Outcome;
      try {
        const plan = await reconcileFactVersions({ versions: c.versions, client });
        out = judge(c, plan);
      } catch (e) {
        out = { ok: false, hard: false, detail: `调用抛错：${e instanceof Error ? e.message : String(e)}` };
      }
      const t = tally.get(c.name)!;
      if (out.ok) t.pass++;
      else if (out.hard) t.hard++;
      else t.soft++;
      if (!out.ok) t.details.push(`run${run}: ${out.detail}`);
      console.log(`${out.ok ? "✅" : out.hard ? "🔴" : "⚠️ "} ${c.name} — ${out.detail}`);
    }
    console.log("");
  }

  console.log("========== 汇总 ==========");
  let hardTotal = 0;
  for (const c of CASES) {
    const t = tally.get(c.name)!;
    hardTotal += t.hard;
    const flag = t.hard > 0 ? "🔴" : t.soft > 0 ? "⚠️ " : "✅";
    console.log(`${flag} ${c.name}`);
    console.log(`     通过 ${t.pass}/${RUNS} ｜ 红线级失败 ${t.hard} ｜ 软失败 ${t.soft}`);
    console.log(`     为什么测这条：${c.why}`);
    for (const d of t.details.slice(0, 3)) console.log(`     ${d}`);
  }
  console.log("");
  console.log("========== 结论（贴回给首席用这段）==========");
  console.log(`红线级失败合计：${hardTotal} 次`);
  console.log(hardTotal === 0
    ? "红线未破：不同雇主/不同项目未被判为同一件事，合并 value 均可溯回原文"
    : "🔴 红线已破 —— 该模块不得上生产，按 D037 §五#4「不稳定的就不要用了」退回诊断态");
  console.log("");
  console.log("⚠ 局限（必须随结论一起读）：");
  console.log("  1. 合成样本，有过拟合风险；真实事实库上的表现仍需复验");
  console.log("  2. 本脚本只验判定方向，不验 rationale 写得好不好");
  console.log("  3. 终判权在用户 —— 域一级自审已被 08-05 实证不成立");
}

void main();

