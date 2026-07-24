import type {
  Conflict,
  DecideRequest,
  EligibilityRejection,
  EligibilityResult,
  RetrievalCandidate,
  SourceDocument,
} from "./types.ts";
import { tokenize } from "./retrieval.ts";

function endOfValidity(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return Date.parse(`${value}T23:59:59.999Z`);
  return Date.parse(value);
}

function matchesScope(allowed: string[], actual: string): boolean {
  return allowed.length === 0 || allowed.includes("*") || allowed.includes(actual);
}

export function evaluateEligibility(
  source: SourceDocument,
  request: DecideRequest,
  activeSuperseders: Set<string>,
): EligibilityResult {
  const rejections: EligibilityRejection[] = [];
  const asOf = Date.parse(request.asOf);
  if (source.approval !== "approved") {
    rejections.push({ code: "approval", detail: source.approval });
  }
  if (source.audience !== "employee") {
    rejections.push({ code: "audience", detail: source.audience });
  }
  if (source.policySensitivity === "high") {
    rejections.push({ code: "sensitivity", detail: "high" });
  }
  if (Date.parse(source.effectiveFrom) > asOf) {
    rejections.push({ code: "future", detail: source.effectiveFrom });
  }
  if (source.effectiveTo && endOfValidity(source.effectiveTo) < asOf) {
    rejections.push({ code: "expired", detail: source.effectiveTo });
  }
  const scope = source.eligibility;
  if (
    !matchesScope(scope.legalEntityIds, request.requester.legalEntityId) ||
    !matchesScope(scope.baseIds, request.requester.baseId) ||
    !matchesScope(scope.relationships, request.requester.relationship) ||
    !matchesScope(scope.roles, request.requester.role)
  ) {
    rejections.push({ code: "scope", detail: "trusted requester does not match declared scope" });
  }
  if (activeSuperseders.has(`${source.sourceId}@${source.versionId}`) || activeSuperseders.has(source.sourceId)) {
    rejections.push({ code: "superseded", detail: "an effective source explicitly supersedes this record" });
  }
  return rejections.length > 0 ? { eligible: false, rejections } : { eligible: true };
}

export function activeSupersededSources(documents: SourceDocument[], request: DecideRequest): Set<string> {
  const asOf = Date.parse(request.asOf);
  const superseded = new Set<string>();
  for (const document of documents) {
    if (
      document.approval === "approved" &&
      Date.parse(document.effectiveFrom) <= asOf &&
      (!document.effectiveTo || endOfValidity(document.effectiveTo) >= asOf)
    ) {
      for (const source of document.supersedes ?? []) superseded.add(source);
    }
  }
  return superseded;
}

function normalizedNumbers(value: string): string[] {
  return [...value.matchAll(/\b(?:\d+(?:[.,]\d+)?|primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|sext[oa])\b/giu)]
    .map((match) => match[0].toLocaleLowerCase("pt-BR"));
}

function hasNegation(value: string): boolean {
  return /\b(?:não|nao|nunca|jamais|sem)\b/iu.test(value);
}

function hasOpposedTiming(left: string, right: string): boolean {
  const later = /\b(?:seguinte|depois|posterior|tardia)\b/iu;
  const earlier = /\b(?:antes|anterior|prévia|previa)\b/iu;
  return (later.test(left) && earlier.test(right)) || (earlier.test(left) && later.test(right));
}

function contentTerms(value: string): Set<string> {
  return new Set(tokenize(value).filter((term) => term.length >= 4));
}

function overlap(left: Set<string>, right: Set<string>): number {
  const shared = [...left].filter((term) => right.has(term)).length;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

export function detectConflicts(candidates: RetrievalCandidate[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const strongestBySource = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    if (!strongestBySource.has(candidate.document.sourceId)) {
      strongestBySource.set(candidate.document.sourceId, candidate);
    }
  }
  const distinct = [...strongestBySource.values()].slice(0, 8);
  for (let leftIndex = 0; leftIndex < distinct.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < distinct.length; rightIndex += 1) {
      const left = distinct[leftIndex];
      const right = distinct[rightIndex];
      if (left.document.domain !== right.document.domain) continue;
      const textOverlap = overlap(contentTerms(left.passage.answerText), contentTerms(right.passage.answerText));
      if (textOverlap < 0.28) continue;
      const signals: string[] = [];
      const leftNumbers = normalizedNumbers(left.passage.answerText);
      const rightNumbers = normalizedNumbers(right.passage.answerText);
      if (leftNumbers.length > 0 && rightNumbers.length > 0 &&
        leftNumbers.some((value) => !rightNumbers.includes(value)) &&
        rightNumbers.some((value) => !leftNumbers.includes(value))) {
        signals.push("incompatible_values");
      }
      if (textOverlap >= 0.42 && hasNegation(left.passage.answerText) !== hasNegation(right.passage.answerText)) {
        signals.push("opposed_polarity");
      }
      if (textOverlap >= 0.24 && hasOpposedTiming(left.passage.answerText, right.passage.answerText)) {
        signals.push("incompatible_timing");
      }
      if (signals.length > 0) conflicts.push({ domain: left.document.domain, left, right, signals });
    }
  }
  return conflicts;
}
