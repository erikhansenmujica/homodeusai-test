import type { DecideRequest, Decision, HistoryTurn, RequesterContext } from "./types.ts";

const MAX_QUESTION_CHARS = 12_000;
const MAX_HISTORY_TURNS = 20;
const MAX_CLAIMS = 64;
const MAX_EVIDENCE_PER_CLAIM = 16;
const MAX_EVIDENCE_BYTES = 4_096;
const MAX_VALIDATION_ERRORS = 128;
const HANDOFF_REASONS = new Set([
  "human_requested",
  "low_confidence",
  "conflicting_source",
  "missing_source",
  "profile_mismatch",
  "sensitive_topic",
  "validation_pending",
  "policy_sensitive_source",
  "provider_failure",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function parseRequester(value: unknown): RequesterContext | null {
  if (!isRecord(value)) return null;
  if (
    !nonEmptyString(value.subjectId) ||
    !nonEmptyString(value.legalEntityId) ||
    !nonEmptyString(value.baseId) ||
    !nonEmptyString(value.relationship) ||
    !nonEmptyString(value.role) ||
    !stringArray(value.domains)
  ) {
    return null;
  }
  return {
    subjectId: value.subjectId,
    legalEntityId: value.legalEntityId,
    baseId: value.baseId,
    relationship: value.relationship,
    role: value.role,
    domains: value.domains,
  };
}

function parseHistory(value: unknown): HistoryTurn[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_TURNS) return null;
  const turns: HistoryTurn[] = [];
  for (const item of value) {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant") || !nonEmptyString(item.content)) {
      return null;
    }
    turns.push({ role: item.role, content: item.content });
  }
  return turns;
}

export function parseDecideRequest(value: unknown): { ok: true; value: DecideRequest } | { ok: false; errors: string[] } {
  if (!isRecord(value)) return { ok: false, errors: ["body must be a JSON object"] };

  const errors: string[] = [];
  if (!nonEmptyString(value.requestId)) errors.push("requestId is required");
  if (!nonEmptyString(value.question)) errors.push("question is required");
  if (typeof value.question === "string" && value.question.length > MAX_QUESTION_CHARS) {
    errors.push(`question must be at most ${MAX_QUESTION_CHARS} characters`);
  }
  if (!nonEmptyString(value.asOf) || Number.isNaN(Date.parse(value.asOf))) errors.push("asOf must be an ISO date or datetime");

  const requester = parseRequester(value.requester);
  if (!requester) errors.push("requester is incomplete");
  const history = parseHistory(value.history);
  if (!history) errors.push(`history must contain at most ${MAX_HISTORY_TURNS} valid turns`);

  if (errors.length || !requester || !history) return { ok: false, errors };
  return {
    ok: true,
    value: {
      requestId: value.requestId as string,
      question: value.question as string,
      asOf: value.asOf as string,
      requester,
      history,
    },
  };
}

function validScore(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateDecision(value: unknown): string[] {
  if (!isRecord(value)) return ["decision must be an object"];
  if (!nonEmptyString(value.traceId)) return ["decision.traceId is required"];

  if (value.kind === "conversational") {
    return nonEmptyString(value.body) ? [] : ["conversational.body is required"];
  }

  if (value.kind === "defer") {
    const errors: string[] = [];
    if (!validScore(value.answerabilityScore)) errors.push("defer.answerabilityScore must be between 0 and 1");
    if (!nonEmptyString(value.userMessage)) errors.push("defer.userMessage is required");
    if (!isRecord(value.handoff)) {
      errors.push("defer.handoff is required");
    } else {
      for (const field of ["ticketId", "reasonCode", "queue", "idempotencyKey"] as const) {
        if (!nonEmptyString(value.handoff[field])) errors.push(`defer.handoff.${field} is required`);
      }
      if (typeof value.handoff.reasonCode === "string" && !HANDOFF_REASONS.has(value.handoff.reasonCode)) {
        errors.push("defer.handoff.reasonCode is not recognized");
      }
      if (!Number.isInteger(value.handoff.slaHours) || (value.handoff.slaHours as number) <= 0) {
        errors.push("defer.handoff.slaHours must be a positive integer");
      }
    }
    return errors.slice(0, MAX_VALIDATION_ERRORS);
  }

  if (value.kind === "answer") {
    const errors: string[] = [];
    if (!validScore(value.answerabilityScore)) errors.push("answer.answerabilityScore must be between 0 and 1");
    if (!nonEmptyString(value.body)) errors.push("answer.body is required");
    if (!Array.isArray(value.claims) || value.claims.length === 0) {
      errors.push("answer.claims must not be empty");
    } else {
      if (value.claims.length > MAX_CLAIMS) errors.push(`answer.claims must contain at most ${MAX_CLAIMS} claims`);
      value.claims.slice(0, MAX_CLAIMS).forEach((claim, claimIndex) => {
        if (!isRecord(claim)) {
          errors.push(`answer.claims[${claimIndex}] must be an object`);
          return;
        }
        if (!nonEmptyString(claim.id)) errors.push(`answer.claims[${claimIndex}].id is required`);
        if (!nonEmptyString(claim.text)) errors.push(`answer.claims[${claimIndex}].text is required`);
        if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
          errors.push(`answer.claims[${claimIndex}].evidence must not be empty`);
          return;
        }
        if (claim.evidence.length > MAX_EVIDENCE_PER_CLAIM) errors.push(`answer.claims[${claimIndex}].evidence must contain at most ${MAX_EVIDENCE_PER_CLAIM} references`);
        claim.evidence.slice(0, MAX_EVIDENCE_PER_CLAIM).forEach((reference, evidenceIndex) => {
          const prefix = `answer.claims[${claimIndex}].evidence[${evidenceIndex}]`;
          if (!isRecord(reference)) {
            errors.push(`${prefix} must be an object`);
            return;
          }
          for (const field of ["sourceId", "versionId", "quote"] as const) {
            if (!nonEmptyString(reference[field])) errors.push(`${prefix}.${field} is required`);
          }
          if (!nonEmptyString(reference.quoteSha256) || !/^[a-f0-9]{64}$/i.test(reference.quoteSha256)) {
            errors.push(`${prefix}.quoteSha256 must be a SHA-256 hex digest`);
          }
          if (!Number.isInteger(reference.startByte) || (reference.startByte as number) < 0) {
            errors.push(`${prefix}.startByte must be a non-negative integer`);
          }
          if (!Number.isInteger(reference.endByte) || (reference.endByte as number) <= (reference.startByte as number)) {
            errors.push(`${prefix}.endByte must be greater than startByte`);
          } else if ((reference.endByte as number) - (reference.startByte as number) > MAX_EVIDENCE_BYTES) {
            errors.push(`${prefix} must cite at most ${MAX_EVIDENCE_BYTES} bytes`);
          }
        });
      });
    }
    return errors.slice(0, MAX_VALIDATION_ERRORS);
  }

  return ["decision.kind must be answer, defer, or conversational"];
}
