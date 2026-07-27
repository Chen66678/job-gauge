import type { JobRequirement, JobRisk, RequirementKind, RiskSeverity } from "../types";
import type { OpenAiCompatibleLlmClient } from "./llmClient";
import { isRecord, slugifyAsciiWithCjk, stripMarkdownFence } from "./shared";

export interface JdExtractionInput {
  jdText: string;
  client: OpenAiCompatibleLlmClient;
}

export interface JdExtractionResult {
  requirements: JobRequirement[];
  risks: JobRisk[];
}

interface JdExtractionEnvelope {
  requirements: JdRequirementItem[];
  risks: JdRiskItem[];
}

interface JdRequirementItem {
  kind: RequirementKind;
  label: string;
  evidence: string;
  weight: number;
}

interface JdRiskItem {
  label: string;
  severity: RiskSeverity;
  evidence: string;
}

const JD_EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured job requirements and risks from job descriptions into json.",
  "Only extract requirements and risks that are explicitly stated in the jd or are strong direct implications from the jd wording.",
  "Do not invent, guess, embellish, add standard hiring assumptions, or fill missing conditions.",
  "If the jd does not clearly support an item, leave it out.",
  "Preserve the original language of the job description in every label and evidence value. Do not translate any value into another language, even if it would read more naturally. If the jd is in Chinese, all label and evidence values must remain in Chinese exactly as written.",
  'Return json with exactly this shape: {"requirements":[{"kind":"skill|experience|preference|risk","label":"...","evidence":"...","weight":0.0}],"risks":[{"label":"...","severity":"low|medium|high","evidence":"..."}]}',
  "For every requirement, requiredFactIds must stay empty and must not be inferred or generated.",
  "Weight means how important or hard-required the requirement is in this jd, from 0 to 1.",
  "Use higher weight for hard requirements or repeatedly emphasized items, and lower weight for nice-to-have or optional items.",
  'Requirement kind must be exactly one of "skill", "experience", "preference", or "risk", based on jd semantics only.',
  'Risk severity must be exactly one of "low", "medium", or "high".',
  "Do not return markdown. Do not return prose. Return json only.",
  'If nothing reliable can be extracted, return {"requirements":[],"risks":[]}.'
].join("\n");

const VALID_REQUIREMENT_KINDS: RequirementKind[] = ["skill", "experience", "preference", "risk"];
const VALID_RISK_SEVERITIES: RiskSeverity[] = ["low", "medium", "high"];

export async function extractRequirementsFromJd(input: JdExtractionInput): Promise<JdExtractionResult> {
  const raw = await input.client.completeText({
    system: JD_EXTRACTION_SYSTEM_PROMPT,
    user: buildJdUserPrompt(input.jdText),
    responseFormatJson: true
  });

  const parsed = parseEnvelope(raw);
  if (!parsed) {
    return emptyResult();
  }

  return {
    requirements: parsed.requirements.flatMap((item, index) => {
      const normalized = normalizeRequirement(item);
      if (!normalized) {
        return [];
      }
      return [
        {
          id: buildRequirementId(normalized, index),
          kind: normalized.kind,
          label: normalized.label,
          evidence: normalized.evidence,
          requiredFactIds: [],
          weight: normalized.weight
        } satisfies JobRequirement
      ];
    }),
    risks: parsed.risks.flatMap((item, index) => {
      const normalized = normalizeRisk(item);
      if (!normalized) {
        return [];
      }
      return [
        {
          id: buildRiskId(normalized, index),
          label: normalized.label,
          severity: normalized.severity,
          evidence: normalized.evidence
        } satisfies JobRisk
      ];
    })
  };
}

function buildJdUserPrompt(jdText: string): string {
  return [`Job description text:`, jdText.trim()].join("\n");
}

function parseEnvelope(raw: string): JdExtractionEnvelope | null {
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
    requirements: Array.isArray(value.requirements)
      ? value.requirements
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            kind: item.kind,
            label: item.label,
            evidence: item.evidence,
            weight: item.weight
          }))
          .filter(isRequirementItem)
      : [],
    risks: Array.isArray(value.risks)
      ? value.risks
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            label: item.label,
            severity: item.severity,
            evidence: item.evidence
          }))
          .filter(isRiskItem)
      : []
  };
}

function normalizeRequirement(item: JdRequirementItem): JdRequirementItem | null {
  const label = item.label.trim();
  const evidence = item.evidence.trim();
  if (!label || !evidence) {
    return null;
  }

  return {
    kind: item.kind,
    label,
    evidence,
    weight: clampWeight(item.weight)
  };
}

function normalizeRisk(item: JdRiskItem): JdRiskItem | null {
  const label = item.label.trim();
  const evidence = item.evidence.trim();
  if (!label || !evidence) {
    return null;
  }

  return {
    label,
    severity: item.severity,
    evidence
  };
}

function buildRequirementId(item: JdRequirementItem, index: number): string {
  const slug = slugifyAsciiWithCjk(`${item.kind}-${item.label}`);
  return `req-jd-${index + 1}-${slug}`;
}

function buildRiskId(item: JdRiskItem, index: number): string {
  const slug = slugifyAsciiWithCjk(item.label);
  return `risk-jd-${index + 1}-${slug}`;
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(3));
}

function emptyResult(): JdExtractionResult {
  return { requirements: [], risks: [] };
}

function isRequirementItem(value: unknown): value is JdRequirementItem {
  return (
    isRecord(value) &&
    isRequirementKind(value.kind) &&
    typeof value.label === "string" &&
    typeof value.evidence === "string" &&
    typeof value.weight === "number"
  );
}

function isRiskItem(value: unknown): value is JdRiskItem {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    isRiskSeverity(value.severity) &&
    typeof value.evidence === "string"
  );
}

function isRequirementKind(value: unknown): value is RequirementKind {
  return typeof value === "string" && VALID_REQUIREMENT_KINDS.includes(value as RequirementKind);
}

function isRiskSeverity(value: unknown): value is RiskSeverity {
  return typeof value === "string" && VALID_RISK_SEVERITIES.includes(value as RiskSeverity);
}
