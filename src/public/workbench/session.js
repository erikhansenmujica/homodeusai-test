export const STORAGE_KEY = "nexo-atlantico-decision-history-v3";
export const MAX_HISTORY = 24;

export function makeId(prefix) {
  var suffix = window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(16).slice(2);
  return prefix + "-" + suffix;
}

function boundedString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function decisionSummary(decision) {
  if (!decision || typeof decision !== "object") return null;
  if (decision.kind === "answer") {
    return {
      kind: "answer",
      answerabilityScore: decision.answerabilityScore,
      body: boundedString(decision.body, 8000),
      traceId: boundedString(decision.traceId, 128),
      claims: Array.isArray(decision.claims)
        ? decision.claims.slice(0, 32).map(function (claim) {
            return {
              id: boundedString(claim.id, 128),
              text: boundedString(claim.text, 4000),
              confidence: claim.confidence,
              evidence: Array.isArray(claim.evidence)
                ? claim.evidence.slice(0, 8).map(function (reference) {
                    return {
                      sourceId: boundedString(reference.sourceId, 256),
                      versionId: boundedString(reference.versionId, 128),
                      startByte: reference.startByte,
                      endByte: reference.endByte,
                      quoteSha256: boundedString(reference.quoteSha256, 64),
                      quote: ""
                    };
                  })
                : []
            };
          })
        : []
    };
  }
  if (decision.kind === "defer") {
    return {
      kind: "defer",
      answerabilityScore: decision.answerabilityScore,
      userMessage: boundedString(decision.userMessage, 4000),
      traceId: boundedString(decision.traceId, 128),
      handoff: {
        ticketId: boundedString(decision.handoff && decision.handoff.ticketId, 128),
        reasonCode: boundedString(decision.handoff && decision.handoff.reasonCode, 128),
        queue: boundedString(decision.handoff && decision.handoff.queue, 128),
        slaHours: decision.handoff && decision.handoff.slaHours,
        idempotencyKey: boundedString(decision.handoff && decision.handoff.idempotencyKey, 256)
      }
    };
  }
  if (decision.kind === "conversational") {
    return {
      kind: "conversational",
      body: boundedString(decision.body, 4000),
      traceId: boundedString(decision.traceId, 128)
    };
  }
  if (decision.kind === "error") {
    return {
      kind: "error",
      userMessage: boundedString(decision.userMessage, 1000)
    };
  }
  return null;
}

export function persistSessionEntries(entries, statusNode) {
  try {
    var safeEntries = entries.slice(0, MAX_HISTORY).map(function (entry) {
      return {
        id: boundedString(entry.id, 128),
        requestId: boundedString(entry.requestId, 128),
        threadId: boundedString(entry.threadId, 128),
        parentId: entry.parentId ? boundedString(entry.parentId, 128) : null,
        question: boundedString(entry.question, 12000),
        submittedAt: boundedString(entry.submittedAt, 64),
        asOf: boundedString(entry.asOf, 64),
        profile: entry.profile,
        decision: decisionSummary(entry.decision),
        traceExpanded: Boolean(entry.traceExpanded),
        handoffOpen: Boolean(entry.handoffOpen),
        selectedSource: entry.selectedSource || null
      };
    }).filter(function (entry) {
      return entry.decision;
    });
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 3,
      entries: safeEntries
    }));
  } catch (_error) {
    if (statusNode) {
      statusNode.textContent = "O histórico continuará disponível nesta página, mas não pôde ser salvo nesta sessão.";
    }
  }
}

export function loadSessionEntries() {
  try {
    var raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== 3 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(function (entry) {
      return entry
        && typeof entry.id === "string"
        && typeof entry.threadId === "string"
        && typeof entry.question === "string"
        && entry.profile
        && entry.decision;
    }).slice(0, MAX_HISTORY).map(function (entry) {
      return {
        ...entry,
        trace: null,
        handoffRecord: null
      };
    });
  } catch (_error) {
    return [];
  }
}
