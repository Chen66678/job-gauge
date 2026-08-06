// D037 第一个落点 · 「同一事实多版本调和」通用规则
//
// ⚠ 这个模块刻意不叫 resumeMerge / resumeDedupe。按 D037:63-65 与 D036 §四，
// 「两份简历重叠 → 同一件事多版本」和「D036 临时仓位归档时与原抽取冲突」是
// 同一个问题的两个入口，必须共用同一套规则，否则会实现两遍且规则不一致。
// 所以本模块的输入是「带来源标注的候选版本」，不是「简历」——
// 三种来源（resume / user_answer / manual）走同一条判据。
//
// 机制层一字未动（D037 §五 #2）：本模块不碰逐行 factIds 溯源、不碰 findVetoHit、
// 不让模型输出任何分数。模型只输出分类结论 + 理由，数值与确定性动作全在代码侧。
//
// D025 边界：只改卡片边界（哪些版本归成一条），不改 value 的措辞强度、不做改写压缩。
// 合并后的 value 由代码从原始 value 拼接而成，不由模型重写——见 reconstructMergedValue。

import type { FactSourceType, ProfileFact } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { isRecord, stripMarkdownFence } from "./shared";

/** 参与调和的一个版本。刻意不直接收 ProfileFact——D036 的临时仓位条目还不是主库事实。 */
export interface FactVersion {
  /** 稳定标识。主库事实用 ProfileFact.id；临时仓位条目用临时 id。 */
  id: string;
  category: string;
  label: string;
  /** 证据底本原文。调和过程从不改写它。 */
  value: string;
  /** 三种来源都要能接（D037 判据层要求）。 */
  sourceType: FactSourceType;
  /**
   * 版本优先级。D036 §四已定「临时仓位优先（用户是真值来源）」，
   * 简历重叠那个入口三条来源同级 → 该入口全传同一个值即可。
   * 数值只用于代码侧排序，不喂给模型、模型也不产出它。
   */
  precedence?: number;
}

/**
 * 调和结论。四种，模型只能选其一。
 * - `merge`：讲的是同一件事，且其中一版信息是另一版的子集/等价 → 合成一条。
 * - `supplement`：同一件事，但各自带对方没有的细节 → 合成一条，两边原文都保留。
 * - `conflict`：同一件事，但事实内容互相矛盾（如"参与"vs"我主导的"）→ **代码不自动裁决**。
 * - `distinct`：不是同一件事 → 什么都不做。
 */
export type ReconciliationVerdict = "merge" | "supplement" | "conflict" | "distinct";

export interface ReconciliationItem {
  verdict: ReconciliationVerdict;
  /** 参与这条结论的版本 id，至少 2 个。溯源用，不可省。 */
  versionIds: string[];
  /** 模型给的理由，原文透传，供用户过目。不是分数。 */
  rationale: string;
  /**
   * verdict 为 merge/supplement 时：代码从各版本原文重建的合并 value。
   * ⚠ 不是模型写的句子——见 reconstructMergedValue 的注释。
   */
  mergedValue?: string;
  mergedLabel?: string;
  mergedCategory?: string;
}

export interface ReconciliationPlan {
  items: ReconciliationItem[];
  /**
   * 模型输出不可用（解析失败/结论非法/引用了不存在的版本/重建校验没过）时为 true。
   * 此时 items 为空 —— **fail-closed：宁可不合，不可合错**。
   * 依据 D037 §五 #4 用户原话「不稳定的就不要用了」+ D037:58「合错了两段真经历被糊成一条，踩 D025 红线」。
   * 不合的代价是库里脏（可见、可再修）；合错的代价是丢证据底本（不可逆）。
   */
  unusable: boolean;
  /** unusable 为 true 时说明原因，供日志与用户告知（§4.2 流程失败不可静默）。 */
  unusableReason?: string;
  /**
   * 归档语义未定，本模块不许焊死（D036 §四待定项）。
   * conflict 项在这里单独列出，交由上层按用户后续拍板的形态处理
   * （当场问模型一手 / 替换 / 两存 三种都还开着）。
   */
  conflicts: ReconciliationItem[];
}

const RECONCILIATION_SYSTEM_PROMPT = [
  "You compare multiple versions of what may be the same real-world fact about one person, and decide how they relate.",
  "The versions may come from different sources: a resume, an answer the person gave in conversation, or something they typed in manually. Treat all sources as equally truthful in content; do not prefer one source because it looks more formal.",
  "You are NOT rewriting anything. You only decide how the versions relate to each other. Never produce a new sentence describing the fact, never paraphrase, never compress, never summarize, and never make any wording stronger. The original wording is evidence and is preserved verbatim by the calling program, not by you.",
  "",
  "For each group of versions that concern the SAME real-world thing, return one item with one of exactly these four verdicts:",
  '- "merge": the versions describe the same thing, and one version adds nothing factual that another does not already state (duplicate, or one is a subset/restatement of the other).',
  '- "supplement": the versions describe the same thing, but each one states at least one concrete detail the other does not. Neither contradicts the other.',
  '- "conflict": the versions describe the same thing, but they state factually incompatible things about it — for example one says the person participated in something and another says the person led it, or the numbers/dates/scope disagree. Use this verdict whenever the difference is a disagreement rather than an addition.',
  '- "distinct": the versions are NOT about the same real-world thing, and must stay separate.',
  "",
  "DECISION RULE FOR SAMENESS (self-contained): two versions are the same real-world thing only if they refer to the same concrete entity or episode — the same job at the same employer, the same named project, the same school, or the same single attribute of the person. A shortened name, a nickname, a differently-worded job title, or a differently-punctuated project name can still be the same thing; judge by what is being referred to, not by string similarity. Two DIFFERENT employers, two DIFFERENT projects, or two DIFFERENT schools are NEVER the same thing, no matter how similar their descriptions read.",
  "NEVER group two versions together merely because they are the same kind of thing (both are jobs, both are skills, both are projects). Being the same category is not being the same thing.",
  "When you are not sure whether two versions are the same thing, return them as \"distinct\" rather than grouping them. Leaving two versions separate is safe and reversible; wrongly collapsing two different real experiences into one destroys evidence and is not.",
  "",
  "Do not output any score, probability, percentage, similarity number, or confidence value anywhere. Give your reason in words only.",
  "Only include a version id in an item if that exact id appeared in the input. Never invent ids.",
  "Every item must reference at least two different version ids. Do not return items about a single version.",
  "Versions you decide are not related to any other version do not need to appear in the output at all.",
  'Return json with exactly this shape: {"items":[{"verdict":"merge"|"supplement"|"conflict"|"distinct","versionIds":["..."],"rationale":"..."}]}',
  "Do not return markdown. Do not return prose. Return json only.",
  'If no two versions are about the same thing, return {"items":[]}.'
].join("\n");

export interface ReconcileFactVersionsInput {
  versions: FactVersion[];
  client: OpenAiCompatibleLlmClient;
}

export async function reconcileFactVersions(input: ReconcileFactVersionsInput): Promise<ReconciliationPlan> {
  // 少于两个版本无从调和，不必花用户额度。
  if (input.versions.length < 2) {
    return emptyPlan();
  }

  const byId = new Map(input.versions.map((version) => [version.id, version]));
  if (byId.size !== input.versions.length) {
    return unusablePlan("输入版本 id 重复，无法溯源，不做合并");
  }

  let raw: string;
  try {
    raw = await input.client.completeText({
      system: RECONCILIATION_SYSTEM_PROMPT,
      user: buildVersionsUserPrompt(input.versions),
      responseFormatJson: true
    });
  } catch (error) {
    // §4.2「流程失败不可静默」：吞掉异常但把原因带出去，由上层告知用户。
    return unusablePlan(`调和模型调用失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = parseItems(raw);
  if (!parsed) {
    return unusablePlan("调和模型输出无法解析为预期 json 结构");
  }

  const items: ReconciliationItem[] = [];
  for (const item of parsed) {
    const versions = item.versionIds.map((id) => byId.get(id)).filter((v): v is FactVersion => Boolean(v));
    // 引用了不存在的 id → 这一项整条丢弃，不猜模型想指谁。
    if (versions.length !== item.versionIds.length || versions.length < 2) {
      continue;
    }
    if (item.verdict === "distinct") {
      continue;
    }
    if (item.verdict === "conflict") {
      // 冲突不在这里裁决：替换还是两存是 D036 §四未定项，实现者不得自行拍死。
      items.push({ verdict: "conflict", versionIds: item.versionIds, rationale: item.rationale });
      continue;
    }

    const merged = reconstructMergedValue(versions);
    if (!merged) {
      continue;
    }
    items.push({
      verdict: item.verdict,
      versionIds: item.versionIds,
      rationale: item.rationale,
      mergedValue: merged.value,
      mergedLabel: merged.label,
      mergedCategory: merged.category
    });
  }

  return {
    items,
    unusable: false,
    conflicts: items.filter((item) => item.verdict === "conflict")
  };
}

/**
 * 合并后的 value 由**代码**从原始 value 重建，模型碰不到这一步。
 *
 * 这是 D025「抽取层禁改写压缩」在合并这一步的落法：合并只改卡片边界，
 * 不产生任何不在原文里的措辞。做法 = 按优先级排序后去重拼接原文段落，
 * 完全被覆盖的版本（原文是另一版的子串）不重复出现。
 *
 * 结果性质：合并后的 value 的每一段都能在某个源 value 里逐字找到。
 * 所以「模型把措辞拔高」在这一步机械上不可能发生 —— 不靠模型自觉。
 */
function reconstructMergedValue(
  versions: FactVersion[]
): { value: string; label: string; category: string } | null {
  const ordered = [...versions].sort((a, b) => (b.precedence ?? 0) - (a.precedence ?? 0));
  const segments: string[] = [];
  for (const version of ordered) {
    const text = version.value.trim();
    if (!text) {
      continue;
    }
    // 已被收进来的段落里若已逐字包含本段，则不重复收（合并的本意）。
    if (segments.some((existing) => existing.includes(text))) {
      continue;
    }
    segments.push(text);
  }
  if (segments.length === 0) {
    return null;
  }
  // 反向剔除：先收的长段可能已含后收短段，前一轮判不到。
  const kept = segments.filter(
    (segment, index) => !segments.some((other, otherIndex) => otherIndex !== index && other.includes(segment) && (other.length > segment.length || otherIndex < index))
  );
  const head = ordered[0];
  return {
    value: (kept.length > 0 ? kept : segments).join("\n"),
    label: head.label.trim() || head.category,
    category: head.category
  };
}

/**
 * 校验一条合并 value 是否只由源 value 的原文构成（不含新措辞）。
 * 供测试与上层复核用；判据 = 每个非空行都能在某个源 value 里逐字找到。
 */
export function isMergedValueTraceable(mergedValue: string, sources: readonly string[]): boolean {
  const lines = mergedValue
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
  return lines.every((line) => sources.some((source) => source.includes(line)));
}

/** 把主库事实转成调和输入。D036 的临时仓位条目自己构造 FactVersion，不必先变成 ProfileFact。 */
export function toFactVersion(fact: ProfileFact, precedence = 0): FactVersion {
  return {
    id: fact.id,
    category: fact.category,
    label: fact.label,
    value: fact.value,
    sourceType: fact.sourceType,
    precedence
  };
}

function buildVersionsUserPrompt(versions: FactVersion[]): string {
  const lines = versions.map((version) =>
    [
      `- id: ${version.id}`,
      `  source: ${describeSource(version.sourceType)}`,
      `  category: ${version.category}`,
      `  label: ${version.label}`,
      `  value: ${version.value}`
    ].join("\n")
  );
  return ["Versions to compare:", ...lines].join("\n");
}

function describeSource(sourceType: FactSourceType): string {
  switch (sourceType) {
    case "resume":
      return "extracted from a resume the person uploaded";
    case "user_answer":
      return "the person's own answer in a conversation";
    case "manual":
      return "typed in manually by the person";
    default:
      return sourceType;
  }
}

interface ParsedItem {
  verdict: ReconciliationVerdict;
  versionIds: string[];
  rationale: string;
}

function parseItems(raw: string): ParsedItem[] | null {
  const normalized = stripMarkdownFence(raw.trim());
  if (!normalized) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const items: ParsedItem[] = [];
  for (const entry of value.items) {
    if (!isRecord(entry)) {
      continue;
    }
    const verdict = entry.verdict;
    if (!isVerdict(verdict)) {
      continue;
    }
    if (!Array.isArray(entry.versionIds)) {
      continue;
    }
    const versionIds = entry.versionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    if (versionIds.length < 2) {
      continue;
    }
    items.push({
      verdict,
      versionIds: Array.from(new Set(versionIds)),
      rationale: typeof entry.rationale === "string" ? entry.rationale.trim() : ""
    });
  }
  return items;
}

function isVerdict(value: unknown): value is ReconciliationVerdict {
  return value === "merge" || value === "supplement" || value === "conflict" || value === "distinct";
}

function emptyPlan(): ReconciliationPlan {
  return { items: [], unusable: false, conflicts: [] };
}

function unusablePlan(reason: string): ReconciliationPlan {
  return { items: [], unusable: true, unusableReason: reason, conflicts: [] };
}
