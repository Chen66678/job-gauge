import type { FactTrace, ProfileFact, UserProfile } from "../types";

export function getConfirmedFacts(profile: UserProfile): ProfileFact[] {
  return profile.facts.filter((fact) => fact.status === "confirmed");
}

export function getFactById(profile: UserProfile, factId: string): ProfileFact | undefined {
  return profile.facts.find((fact) => fact.id === factId);
}

export function isFactConfirmed(profile: UserProfile, factId: string): boolean {
  return getFactById(profile, factId)?.status === "confirmed";
}

export function toFactTrace(fact: ProfileFact): FactTrace {
  return {
    factId: fact.id,
    label: fact.label,
    value: fact.value,
    source: `${sourceLabel(fact.sourceType)} - ${fact.sourceRef}`
  };
}

export function sourceLabel(sourceType: ProfileFact["sourceType"]): string {
  if (sourceType === "resume") return "简历";
  if (sourceType === "user_answer") return "补充回答";
  return "手动录入";
}

export function statusLabel(status: ProfileFact["status"]): string {
  if (status === "confirmed") return "已确认";
  if (status === "unconfirmed") return "待确认";
  return "已排除";
}
