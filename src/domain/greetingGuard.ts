import type { ProfileFact } from "../types";

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?%?/g;
const EXPERIENCE_PATTERN = /(?:\d+(?:[.,]\d+)?\s*(?:年经验|年工作经验|years?\s+of\s+experience|years?\s+experience))/gi;

/**
 * 0.1 临时黑名单式规则：数字和年限默认剥离，只有当前 job 的 knownHardFacts
 * 或 confirmed fact 文本能支撑时保留。公司名暂只覆盖 knownHardFacts 场景；通用
 * 公司名识别需要 NER，属于 0.3+ 内容域。
 */
export function sanitizeGreeting(greeting: string, confirmedFacts: ProfileFact[], knownHardFacts: string[] = []): string {
  const confirmed = confirmedFacts.filter((fact) => fact.status === "confirmed");
  const supported = (token: string) =>
    knownHardFacts.some((fact) => fact.toLocaleLowerCase().includes(token.toLocaleLowerCase())) ||
    confirmed.some((fact) => `${fact.label} ${fact.value}`.toLocaleLowerCase().includes(token.toLocaleLowerCase()));

  let sanitized = greeting.trim();
  sanitized = sanitized.replace(NUMBER_PATTERN, (number, offset: number, source: string) => {
    const experience = [...source.matchAll(EXPERIENCE_PATTERN)].find(
      (match) => offset >= (match.index ?? -1) && offset < (match.index ?? 0) + match[0].length
    );
    return experience && supported(experience[0]) ? number : "";
  });

  return sanitized
    .replace(/[，,、:：;；]\s*[，,、:：;；]/g, "，")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,、:：;；\s]+|[，,、:：;；\s]+$/g, "")
    .trim();
}
