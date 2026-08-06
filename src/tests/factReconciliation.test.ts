import { describe, expect, it, vi } from "vitest";
import {
  isMergedValueTraceable,
  reconcileFactVersions,
  toFactVersion,
  type FactVersion
} from "../domain/factReconciliation";
import type { OpenAiCompatibleLlmClient } from "../domain/llmClient";
import type { ProfileFact } from "../types";

function createMockClient(reply: string | (() => Promise<string>)): OpenAiCompatibleLlmClient {
  return {
    completeText: typeof reply === "string" ? vi.fn(async () => reply) : vi.fn(reply),
    completeVision: vi.fn(async () => {
      throw new Error("completeVision must not be used for fact reconciliation");
    })
  } as unknown as OpenAiCompatibleLlmClient;
}

const RESUME_A: FactVersion = {
  id: "fact-a",
  category: "experience",
  label: "内容自动化流程",
  value: "将负责人“垂直行业内容自动化”的设想落成可运行流程",
  sourceType: "resume",
  precedence: 0
};

const RESUME_B: FactVersion = {
  id: "fact-b",
  category: "experience",
  label: "内容自动化流程",
  value: "将负责人“垂直行业内容自动化”的设想落成可运行流程，内测版本产出 10+ 篇结构化初稿",
  sourceType: "resume",
  precedence: 0
};

describe("reconcileFactVersions", () => {
  it("不足两个版本时不调模型，不花额度", async () => {
    const client = createMockClient("{\"items\":[]}");
    const plan = await reconcileFactVersions({ versions: [RESUME_A], client });

    expect(client.completeText).not.toHaveBeenCalled();
    expect(plan.items).toEqual([]);
    expect(plan.unusable).toBe(false);
  });

  it("merge 结论下合并 value 全部由源原文重建，不含模型新措辞", async () => {
    // 模型即使试图塞一句改写过的话，也进不到 mergedValue —— 结构里没有这个字段的入口。
    const client = createMockClient(
      JSON.stringify({
        items: [
          {
            verdict: "merge",
            versionIds: ["fact-a", "fact-b"],
            rationale: "两条指同一段实习里的同一件事，B 多了产出数量",
            mergedValue: "主导垂直行业内容自动化体系，成效显著"
          }
        ]
      })
    );

    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    expect(plan.unusable).toBe(false);
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0]!;
    expect(item.verdict).toBe("merge");
    expect(item.versionIds).toEqual(["fact-a", "fact-b"]);
    // 红线：模型那句"主导……成效显著"不得出现在合并结果里。
    expect(item.mergedValue).not.toContain("主导垂直行业内容自动化体系");
    expect(item.mergedValue).not.toContain("成效显著");
    expect(isMergedValueTraceable(item.mergedValue!, [RESUME_A.value, RESUME_B.value])).toBe(true);
  });

  it("被完全包含的短版本不重复出现在合并结果里", async () => {
    const client = createMockClient(
      JSON.stringify({
        items: [{ verdict: "merge", versionIds: ["fact-a", "fact-b"], rationale: "A 是 B 的子集" }]
      })
    );

    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    const merged = plan.items[0]!.mergedValue!;
    expect(merged).toBe(RESUME_B.value);
    expect(merged.split("\n")).toHaveLength(1);
  });

  it("supplement 结论下两边原文都保留", async () => {
    const left: FactVersion = { ...RESUME_A, id: "fact-l", value: "设计行业配置机制，沉淀信源与关键词" };
    const right: FactVersion = { ...RESUME_A, id: "fact-r", value: "内测版本生成 10+ 篇结构化初稿样例" };
    const client = createMockClient(
      JSON.stringify({
        items: [{ verdict: "supplement", versionIds: ["fact-l", "fact-r"], rationale: "各带对方没有的细节" }]
      })
    );

    const plan = await reconcileFactVersions({ versions: [left, right], client });

    const merged = plan.items[0]!.mergedValue!;
    expect(merged).toContain("设计行业配置机制");
    expect(merged).toContain("10+ 篇结构化初稿样例");
    expect(isMergedValueTraceable(merged, [left.value, right.value])).toBe(true);
  });

  it("conflict 不自动裁决：不产 mergedValue，单独列进 conflicts", async () => {
    // D036 §四：替换还是两存是用户未定项，实现者不得自行拍死。
    const resumeSays: FactVersion = { ...RESUME_A, id: "fact-resume", value: "参与内容自动化流程搭建" };
    const userSays: FactVersion = {
      id: "fact-answer",
      category: "experience",
      label: "内容自动化流程",
      value: "这套流程其实是我主导搭的",
      sourceType: "user_answer",
      precedence: 10
    };
    const client = createMockClient(
      JSON.stringify({
        items: [
          {
            verdict: "conflict",
            versionIds: ["fact-resume", "fact-answer"],
            rationale: "简历写参与，用户说主导，强度不一致"
          }
        ]
      })
    );

    const plan = await reconcileFactVersions({ versions: [resumeSays, userSays], client });

    expect(plan.items).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.items[0]!.mergedValue).toBeUndefined();
    expect(plan.items[0]!.verdict).toBe("conflict");
  });

  it("distinct 结论不产生任何动作", async () => {
    const client = createMockClient(
      JSON.stringify({
        items: [{ verdict: "distinct", versionIds: ["fact-a", "fact-b"], rationale: "两家不同公司" }]
      })
    );

    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    expect(plan.items).toEqual([]);
    expect(plan.unusable).toBe(false);
  });

  it("三种来源都能进同一次调和（通用规则，非简历专用）", async () => {
    const fromResume: FactVersion = { ...RESUME_A, id: "v-resume", sourceType: "resume" };
    const fromAnswer: FactVersion = { ...RESUME_A, id: "v-answer", sourceType: "user_answer", precedence: 10 };
    const fromManual: FactVersion = { ...RESUME_A, id: "v-manual", sourceType: "manual", precedence: 5 };
    const client = createMockClient(
      JSON.stringify({
        items: [{ verdict: "merge", versionIds: ["v-resume", "v-answer", "v-manual"], rationale: "同一件事三处都提到" }]
      })
    );

    const plan = await reconcileFactVersions({ versions: [fromResume, fromAnswer, fromManual], client });

    expect(plan.items[0]!.versionIds).toHaveLength(3);
    const prompt = (client.completeText as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { user: string };
    expect(prompt.user).toContain("extracted from a resume");
    expect(prompt.user).toContain("own answer in a conversation");
    expect(prompt.user).toContain("typed in manually");
  });

  it("临时仓位优先级高时，合并结果以它的原文领头（D036 §四已定部分）", async () => {
    const staged: FactVersion = {
      id: "staged-1",
      category: "experience",
      label: "内容自动化",
      value: "这套流程我从零搭到内测上线",
      sourceType: "user_answer",
      precedence: 10
    };
    const client = createMockClient(
      JSON.stringify({
        items: [{ verdict: "supplement", versionIds: ["staged-1", "fact-a"], rationale: "用户补充了范围" }]
      })
    );

    const plan = await reconcileFactVersions({ versions: [staged, RESUME_A], client });

    expect(plan.items[0]!.mergedValue!.startsWith(staged.value)).toBe(true);
  });

  it("模型输出无法解析时 fail-closed：不合并且明确报不可用", async () => {
    const client = createMockClient("这不是 json");
    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    expect(plan.unusable).toBe(true);
    expect(plan.unusableReason).toBeTruthy();
    expect(plan.items).toEqual([]);
  });

  it("模型调用抛错时不静默：unusable + 原因带出（§4.2）", async () => {
    const client = createMockClient(async () => {
      throw new Error("network_failure");
    });
    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    expect(plan.unusable).toBe(true);
    expect(plan.unusableReason).toContain("network_failure");
    expect(plan.items).toEqual([]);
  });

  it("引用不存在的版本 id 的条目整条丢弃，不猜模型指谁", async () => {
    const client = createMockClient(
      JSON.stringify({
        items: [
          { verdict: "merge", versionIds: ["fact-a", "fact-does-not-exist"], rationale: "编的 id" },
          { verdict: "merge", versionIds: ["fact-a", "fact-b"], rationale: "真的" }
        ]
      })
    );

    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.versionIds).toEqual(["fact-a", "fact-b"]);
  });

  it("只引用一个版本的条目丢弃（合并至少要两版）", async () => {
    const client = createMockClient(
      JSON.stringify({ items: [{ verdict: "merge", versionIds: ["fact-a"], rationale: "单条" }] })
    );

    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    expect(plan.items).toEqual([]);
    expect(plan.unusable).toBe(false);
  });

  it("非法 verdict 的条目丢弃", async () => {
    const client = createMockClient(
      JSON.stringify({
        items: [{ verdict: "probably_same", versionIds: ["fact-a", "fact-b"], rationale: "瞎猜" }]
      })
    );

    const plan = await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    expect(plan.items).toEqual([]);
  });

  it("prompt 侧禁止模型输出任何分数（D037 划在代码一侧）", async () => {
    const client = createMockClient("{\"items\":[]}");
    await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    const call = (client.completeText as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      system: string;
      responseFormatJson?: boolean;
    };
    expect(call.responseFormatJson).toBe(true);
    expect(call.system).toContain("Do not output any score");
    expect(call.system).toContain("similarity number");
  });

  it("prompt 侧写明不同雇主/项目/学校永不算同一件事（D025 红线）", async () => {
    const client = createMockClient("{\"items\":[]}");
    await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    const call = (client.completeText as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { system: string };
    expect(call.system).toContain("NEVER the same thing");
    expect(call.system).toContain("Being the same category is not being the same thing");
    // 拿不准时留两条，不合 —— 与"合错不可逆"对应。
    expect(call.system).toContain("rather than grouping them");
  });

  it("prompt 侧禁止模型改写措辞（D025 禁改写压缩）", async () => {
    const client = createMockClient("{\"items\":[]}");
    await reconcileFactVersions({ versions: [RESUME_A, RESUME_B], client });

    const call = (client.completeText as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { system: string };
    expect(call.system).toContain("never paraphrase");
    expect(call.system).toContain("never make any wording stronger");
  });

  it("输入 id 重复时拒绝调和（溯源不了就不动）", async () => {
    const client = createMockClient("{\"items\":[]}");
    const plan = await reconcileFactVersions({
      versions: [RESUME_A, { ...RESUME_B, id: RESUME_A.id }],
      client
    });

    expect(client.completeText).not.toHaveBeenCalled();
    expect(plan.unusable).toBe(true);
  });
});

describe("toFactVersion", () => {
  it("从主库事实构造版本，保留 id/原文/来源", () => {
    const fact: ProfileFact = {
      id: "fact-resume-3-experience",
      category: "experience",
      label: "内容自动化",
      value: "将“AI 搜索-人工验证-AI 写作”固化为流程",
      sourceType: "resume",
      sourceRef: "resume_text#2026-08-06T00:00:00.000Z#3",
      status: "confirmed",
      confidence: 0.9,
      groupId: "fact-group-huakai",
      summary: "内容自动化流程"
    };

    expect(toFactVersion(fact, 3)).toEqual({
      id: fact.id,
      category: fact.category,
      label: fact.label,
      value: fact.value,
      sourceType: "resume",
      precedence: 3
    });
  });
});

describe("isMergedValueTraceable", () => {
  it("每行都能在源原文里逐字找到才算可溯源", () => {
    expect(isMergedValueTraceable("甲\n乙", ["甲", "乙"])).toBe(true);
    expect(isMergedValueTraceable("甲\n丙", ["甲", "乙"])).toBe(false);
    expect(isMergedValueTraceable("", ["甲"])).toBe(false);
  });
});
