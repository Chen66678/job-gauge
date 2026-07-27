import type { JobPosting, PreferenceRuleSet } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import type { RiskSensitivity } from "./llmScoring";
import { isRecord, slugifyAsciiWithCjk, stripMarkdownFence } from "./shared";

export interface HardVetoRule {
  id: string;
  label: string;
  kind: "city" | "keyword" | "other";
  mode?: "allowlist" | "blocklist";
  matchTerms: string[];
  evidence: string;
}

export interface HardVetoRules {
  rules: HardVetoRule[];
}

export type RiskSensitivityLevel = "ignore" | "mild" | "strong";

interface PreferenceParsingEnvelope {
  soft: SoftPreferenceItem;
  veto: VetoItem[];
}

interface SoftPreferenceItem {
  targetCities: string[];
  minSalaryK: number;
  preferCompanyTags: string[];
  excludedKeywords: string[];
  riskSensitivity: RiskSensitivityLevel;
}

interface VetoItem {
  label: string;
  kind: "city" | "keyword" | "other";
  mode?: "allowlist" | "blocklist";
  matchTerms: string[];
  evidence: string;
}

const PREFERENCE_PARSING_SYSTEM_PROMPT = [
  "You parse job preference text into structured json.",
  "Only extract preferences and veto rules that are explicitly stated by the user.",
  "Do not invent missing preferences, keywords, cities, company tags, salary, or veto rules.",
  "If the user did not mention a field, leave it empty or default.",
  "Preserve the original language of the user's text in every extracted value, including targetCities, preferCompanyTags, excludedKeywords, and veto label/evidence. Do not translate any value into another language, even if it would read more naturally. If the user wrote in Chinese, all extracted values must remain in Chinese exactly as written.",
  'Return json with exactly this shape: {"soft":{"targetCities":["..."],"minSalaryK":0,"preferCompanyTags":["..."],"excludedKeywords":["..."],"riskSensitivity":"ignore|mild|strong"},"veto":[{"label":"...","kind":"city|keyword|other","mode":"allowlist|blocklist","matchTerms":["..."],"evidence":"..."}]}',
  "For city veto rules: use mode=allowlist when the user says they only want to go to specific cities (只去X); use mode=blocklist when the user says they never want to go to specific cities (绝不去X/不去X/不想去X). For keyword/other kind, mode can be omitted.",
  "Risk sensitivity must be a discrete level only: ignore, mild, or strong.",
  "Do not output any custom numeric scoring weights.",
  "Use cities only when the user explicitly names cities.",
  "Use excludedKeywords only when the user explicitly states things to avoid.",
  "Use preferCompanyTags only when the user explicitly states company-type preferences.",
  "For veto rules, evidence must quote or closely reflect the user's own wording.",
  "Do not return markdown. Do not return prose. Return json only."
].join("\n");

const DEFAULT_RISK_SENSITIVITY_LEVEL: RiskSensitivityLevel = "mild";

const RISK_SENSITIVITY_BY_LEVEL: Record<RiskSensitivityLevel, RiskSensitivity> = {
  ignore: { low: 0, medium: 0, high: 0 },
  mild: { low: 3, medium: 8, high: 16 },
  strong: { low: 8, medium: 20, high: 40 }
};

export async function parsePreferences(input: {
  acceptText: string;
  vetoText: string;
  client: OpenAiCompatibleLlmClient;
}): Promise<{
  preferences: PreferenceRuleSet;
  riskSensitivity: RiskSensitivity;
  hardVeto: HardVetoRules;
}> {
  const raw = await input.client.completeText({
    system: PREFERENCE_PARSING_SYSTEM_PROMPT,
    user: buildUserPrompt(input.acceptText, input.vetoText),
    responseFormatJson: true
  });

  const parsed = parseEnvelope(raw);
  const soft = normalizeSoftPreferences(parsed?.soft);
  const hardVeto = normalizeHardVeto(parsed?.veto ?? []);

  return {
    preferences: {
      targetRoles: [],
      targetCities: soft.targetCities,
      minSalaryK: soft.minSalaryK,
      excludedKeywords: soft.excludedKeywords,
      preferCompanyTags: soft.preferCompanyTags,
      confidence: 1.0
    },
    riskSensitivity: RISK_SENSITIVITY_BY_LEVEL[soft.riskSensitivity],
    hardVeto
  };
}

export function findVetoHit(job: JobPosting, veto: HardVetoRules): HardVetoRule | null {
  const haystack = `${job.title} ${job.company} ${job.city} ${job.companyTags.join(" ")} ${job.jdText}`.toLowerCase();
  const cityText = job.city.toLowerCase();

  for (const rule of veto.rules) {
    const terms = rule.matchTerms.map((term) => term.toLowerCase());
    if (rule.kind === "city") {
      // 插件抓取的岗位 city 可能为空串；城市未知时跳过城市规则，
      // 否则 allowlist 模式会误杀所有缺失城市的岗位。
      if (!cityText.trim()) {
        continue;
      }
      const mode = rule.mode ?? "allowlist";
      if (mode === "allowlist") {
        if (terms.length > 0 && !terms.some((term) => cityText.includes(term))) {
          return rule;
        }
      } else {
        if (terms.some((term) => cityText.includes(term))) {
          return rule;
        }
      }
      continue;
    }

    if (terms.some((term) => haystack.includes(term))) {
      return rule;
    }
  }

  return null;
}

function buildUserPrompt(acceptText: string, vetoText: string): string {
  return JSON.stringify(
    {
      acceptText: acceptText.trim(),
      vetoText: vetoText.trim()
    },
    null,
    2
  );
}

function parseEnvelope(raw: string): PreferenceParsingEnvelope | null {
  const normalized = raw.trim();
  if (!normalized) {
    return null;
  }

  const withoutFence = stripMarkdownFence(normalized);

  let value: unknown;
  try {
    value = JSON.parse(withoutFence);
  } catch {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  return {
    soft: isRecord(value.soft)
      ? {
          targetCities: toStringArray(value.soft.targetCities),
          minSalaryK: parseNumberish(value.soft.minSalaryK),
          preferCompanyTags: toStringArray(value.soft.preferCompanyTags),
          excludedKeywords: toStringArray(value.soft.excludedKeywords),
          riskSensitivity: normalizeRiskSensitivityLevel(value.soft.riskSensitivity)
        }
      : defaultSoftPreferenceItem(),
    veto: Array.isArray(value.veto)
      ? value.veto
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            label: typeof item.label === "string" ? item.label : "",
            kind: normalizeVetoKind(item.kind),
            mode: normalizeVetoMode(item.mode),
            matchTerms: toStringArray(item.matchTerms),
            evidence: typeof item.evidence === "string" ? item.evidence : ""
          }))
      : []
  };
}

function normalizeSoftPreferences(soft: SoftPreferenceItem | undefined): SoftPreferenceItem {
  const value = soft ?? defaultSoftPreferenceItem();
  return {
    targetCities: normalizeStringArray(value.targetCities),
    minSalaryK: normalizeMinSalaryK(value.minSalaryK),
    preferCompanyTags: normalizeStringArray(value.preferCompanyTags),
    excludedKeywords: normalizeStringArray(value.excludedKeywords),
    riskSensitivity: normalizeRiskSensitivityLevel(value.riskSensitivity)
  };
}

function normalizeHardVeto(items: VetoItem[]): HardVetoRules {
  return {
    rules: items.flatMap((item, index) => {
      const label = item.label.trim();
      const evidence = item.evidence.trim();
      if (!label || !evidence) {
        return [];
      }

      const matchTerms = normalizeStringArray(item.matchTerms);
      const mode = normalizeVetoMode(item.mode);
      return [
        {
          id: buildHardVetoId(item, index),
          label,
          kind: item.kind,
          ...(mode !== undefined ? { mode } : {}),
          matchTerms,
          evidence
        } satisfies HardVetoRule
      ];
    })
  };
}

function defaultSoftPreferenceItem(): SoftPreferenceItem {
  return {
    targetCities: [],
    minSalaryK: 0,
    preferCompanyTags: [],
    excludedKeywords: [],
    riskSensitivity: DEFAULT_RISK_SENSITIVITY_LEVEL
  };
}

function normalizeStringArray(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeMinSalaryK(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
}

function normalizeRiskSensitivityLevel(value: unknown): RiskSensitivityLevel {
  return value === "ignore" || value === "mild" || value === "strong" ? value : DEFAULT_RISK_SENSITIVITY_LEVEL;
}

function normalizeVetoKind(value: unknown): HardVetoRule["kind"] {
  return value === "city" || value === "keyword" || value === "other" ? value : "other";
}

function normalizeVetoMode(value: unknown): HardVetoRule["mode"] {
  if (value === "allowlist" || value === "blocklist") {
    return value;
  }
  return undefined;
}

function buildHardVetoId(item: VetoItem, index: number): string {
  const slug = slugifyAsciiWithCjk(`${item.kind}-${item.label}`);
  return `veto-${index + 1}-${slug}`;
}

function parseNumberish(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
