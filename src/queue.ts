import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DecideRequest, Handoff, HandoffReason, HandoffRecord } from "./types.ts";

const ROUTES: Record<HandoffReason, { queue: string; slaHours: number }> = {
  human_requested: { queue: "people_ops_triage", slaHours: 24 },
  low_confidence: { queue: "people_ops_triage", slaHours: 24 },
  conflicting_source: { queue: "knowledge_governance", slaHours: 24 },
  missing_source: { queue: "knowledge_governance", slaHours: 24 },
  profile_mismatch: { queue: "people_ops_triage", slaHours: 24 },
  sensitive_topic: { queue: "people_data", slaHours: 8 },
  validation_pending: { queue: "knowledge_governance", slaHours: 24 },
  policy_sensitive_source: { queue: "people_ops_lead", slaHours: 24 },
  provider_failure: { queue: "people_ops_triage", slaHours: 4 },
};

const NEXT_ACTIONS: Record<HandoffReason, string> = {
  human_requested: "People Operations should contact the requester and continue from the recorded question.",
  low_confidence: "People Operations should validate the applicable sources and record the supported next step.",
  conflicting_source: "Knowledge Governance should reconcile the conflicting records before an answer is released.",
  missing_source: "Knowledge Governance should locate or commission the missing authoritative record.",
  profile_mismatch: "People Operations should verify the trusted requester context before continuing.",
  sensitive_topic: "People Data should move the request to the protected workflow and contact the requester there.",
  validation_pending: "Knowledge Governance should complete source validation and notify the requester of the result.",
  policy_sensitive_source: "The People Operations lead should review whether the source may support this requester-facing answer.",
  provider_failure: "People Operations should continue manually while Platform reviews the provider incident.",
};

const EVIDENCE_GAPS: Record<HandoffReason, string[]> = {
  human_requested: ["A human response was explicitly requested."],
  low_confidence: ["The service could not establish enough eligible support for an autonomous answer."],
  conflicting_source: ["Eligible records disagree on a material decision boundary."],
  missing_source: ["The supplied corpus does not contain the authority needed to answer."],
  profile_mismatch: ["The trusted requester context does not match the source scope."],
  sensitive_topic: ["The request requires a protected human workflow."],
  validation_pending: ["A material source has not completed governance validation."],
  policy_sensitive_source: ["The available source requires policy-owner review before requester-facing use."],
  provider_failure: ["The optional provider did not return a usable result."],
};

const storeDirectory = resolve(process.env.RUNTIME_STATE_PATH ?? process.env.INDEX_PATH ?? "/tmp/nexo-index");
const storePath = join(storeDirectory, "handoffs.json");
const ticketsByKey = new Map<string, HandoffRecord>();
const ticketsById = new Map<string, HandoffRecord>();
let loaded = false;

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function loadStore(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(storePath)) return;
  const parsed = JSON.parse(readFileSync(storePath, "utf8")) as { records?: HandoffRecord[] };
  if (!Array.isArray(parsed.records)) throw new Error("handoff store is invalid");
  for (const record of parsed.records) {
    if (!record?.ticketId || !record.idempotencyKey) throw new Error("handoff store contains an invalid record");
    ticketsByKey.set(record.idempotencyKey, record);
    ticketsById.set(record.ticketId, record);
  }
}

function persistStore(): void {
  mkdirSync(storeDirectory, { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  const records = [...ticketsById.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  writeFileSync(temporaryPath, `${JSON.stringify({ schemaVersion: "1.0", records }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, storePath);
}

function toReceipt(record: HandoffRecord): Handoff {
  return {
    ticketId: record.ticketId,
    reasonCode: record.reasonCode,
    queue: record.queue,
    slaHours: record.slaHours,
    idempotencyKey: record.idempotencyKey,
  };
}

export function createHandoff(input: DecideRequest, reasonCode: HandoffReason, traceId: string): Handoff {
  loadStore();
  const idempotencyKey = shortHash(`${input.requestId}:${reasonCode}`);
  const prior = ticketsByKey.get(idempotencyKey);
  if (prior) return toReceipt(prior);

  const route = ROUTES[reasonCode];
  const now = new Date().toISOString();
  const record: HandoffRecord = {
    ticketId: `dev-${idempotencyKey.slice(0, 12)}`,
    reasonCode,
    queue: route.queue,
    slaHours: route.slaHours,
    idempotencyKey,
    status: "open",
    createdAt: now,
    updatedAt: now,
    traceId,
    request: {
      requestId: input.requestId,
      question: input.question,
      asOf: input.asOf,
      requester: input.requester,
      history: input.history ?? [],
    },
    evidenceGaps: EVIDENCE_GAPS[reasonCode],
    nextAction: NEXT_ACTIONS[reasonCode],
  };
  ticketsByKey.set(idempotencyKey, record);
  ticketsById.set(record.ticketId, record);
  persistStore();
  return toReceipt(record);
}

export function getHandoff(ticketId: string): HandoffRecord | undefined {
  loadStore();
  return ticketsById.get(ticketId);
}

export function resolveHandoff(ticketId: string, actorId: string, summary: string): HandoffRecord | undefined {
  loadStore();
  const prior = ticketsById.get(ticketId);
  if (!prior) return undefined;
  if (prior.status === "resolved") return prior;
  const resolvedAt = new Date().toISOString();
  const record: HandoffRecord = {
    ...prior,
    status: "resolved",
    updatedAt: resolvedAt,
    resolution: { actorId, summary, resolvedAt },
  };
  ticketsByKey.set(record.idempotencyKey, record);
  ticketsById.set(record.ticketId, record);
  persistStore();
  return record;
}

export function resetHandoffsForTest(): void {
  ticketsByKey.clear();
  ticketsById.clear();
  loaded = true;
  rmSync(storePath, { force: true });
}
