import type { ProfileFact } from "../types";

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?%?/g;
const EXPERIENCE_PATTERN = /(?:\d+(?:[.,]\d+)?\s*(?:年经验|年工作经验|years?\s+of\s+experience|years?\s+experience))/gi;

/**
 * 0.1 临时黑名单式规则：含无依据数字/年限的整个分句被删除（只删数字会留下
 * "年经验"这类残句），只有当前 job 的 knownHardFacts 或 confirmed fact 文本
 * 能支撑的经验年限保留。公司名暂只覆盖 knownHardFacts 场景；通用公司名识别
 * 需要 NER，属于 0.3+ 内容域。
 */
export function sanitizeGreeting(greeting: string, confirmedFacts: ProfileFact[], knownHardFacts: string[] = []): string {
  const confirmed = confirmedFacts.filter((fact) => fact.status === "confirmed");
  const supported = (token: string) =>
    knownHardFacts.some((fact) => fact.toLocaleLowerCase().includes(token.toLocaleLowerCase())) ||
    confirmed.some((fact) => `${fact.label} ${fact.value}`.toLocaleLowerCase().includes(token.toLocaleLowerCase()));

  const clauseAllowed = (clause: string): boolean => {
    const experiences = [...clause.matchAll(EXPERIENCE_PATTERN)];
    return [...clause.matchAll(NUMBER_PATTERN)].every((numberMatch) => {
      const offset = numberMatch.index ?? 0;
      const experience = experiences.find(
        (match) => offset >= (match.index ?? -1) && offset < (match.index ?? 0) + match[0].length
      );
      return Boolean(experience && supported(experience[0]));
    });
  };

  const trimmed = greeting.trim();
  const parts = trimmed.split(/([。！!？?；;，,])/);
  let sanitized = "";
  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index] ?? "";
    const delimiter = parts[index + 1] ?? "";
    if (!clause.trim() || clauseAllowed(clause)) {
      sanitized += clause + delimiter;
    }
  }

  sanitized = sanitized
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,、:：;；\s]+|[，,、:：;；\s]+$/g, "")
    .trim();
  if (sanitized && !/[。！!？?]$/.test(sanitized) && /[。！!？?]$/.test(trimmed)) {
    sanitized += "。";
  }
  return sanitized;
}
