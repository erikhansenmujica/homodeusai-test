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
interface StoredHandoffRecord extends HandoffRecord {
  requestFingerprint?: string;
}

export interface HandoffRepository {
  create(input: DecideRequest, reasonCode: HandoffReason, traceId: string): Handoff;
  get(ticketId: string): HandoffRecord | undefined;
  resolve(ticketId: string, actorId: string, summary: string): HandoffRecord | undefined;
  assertHealthy(): void;
  activeTraceIds(): Set<string>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("requestId and handoff reason were reused with different request content");
    this.name = "IdempotencyConflictError";
  }
}

const ticketsByKey = new Map<string, StoredHandoffRecord>();
const ticketsById = new Map<string, StoredHandoffRecord>();
let loaded = false;
let storeFailure: Error | undefined;

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function fingerprint(input: DecideRequest): string {
  return createHash("sha256").update(JSON.stringify({
    requestId: input.requestId,
    question: input.question,
    asOf: input.asOf,
    requester: input.requester,
    history: input.history ?? [],
  }), "utf8").digest("hex");
}

function fingerprintForRecord(record: HandoffRecord): string {
  return fingerprint({
    requestId: record.request.requestId,
    question: record.request.question,
    asOf: record.request.asOf,
    requester: record.request.requester,
    history: record.request.history,
  });
}

function publicRecord(record: StoredHandoffRecord): HandoffRecord {
  const { requestFingerprint: _requestFingerprint, ...visible } = record;
  return visible;
}

function loadStore(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(storePath)) return;
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as { records?: StoredHandoffRecord[] };
    if (!Array.isArray(parsed.records)) throw new Error("handoff store is invalid");
    for (const record of parsed.records) {
      if (!record?.ticketId || !record.idempotencyKey) throw new Error("handoff store contains an invalid record");
      ticketsByKey.set(record.idempotencyKey, record);
      ticketsById.set(record.ticketId, record);
    }
  } catch (error) {
    storeFailure = error instanceof Error ? error : new Error("handoff store is invalid");
    ticketsByKey.clear();
    ticketsById.clear();
  }
}

function ensureHealthy(): void {
  loadStore();
  if (storeFailure) throw new Error(`handoff state is unavailable: ${storeFailure.message}`);
}

function persistStore(): void {
  ensureHealthy();
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
  ensureHealthy();
  const idempotencyKey = shortHash(`${input.requestId}:${reasonCode}`);
  const requestFingerprint = fingerprint(input);
  const prior = ticketsByKey.get(idempotencyKey);
  if (prior) {
    if ((prior.requestFingerprint ?? fingerprintForRecord(prior)) !== requestFingerprint) {
      throw new IdempotencyConflictError();
    }
    return toReceipt(prior);
  }

  const route = ROUTES[reasonCode];
  const now = new Date().toISOString();
  const record: StoredHandoffRecord = {
    ticketId: `ticket-${idempotencyKey.slice(0, 12)}`,
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
    requestFingerprint,
  };
  ticketsByKey.set(idempotencyKey, record);
  ticketsById.set(record.ticketId, record);
  persistStore();
  return toReceipt(record);
}

export function getHandoff(ticketId: string): HandoffRecord | undefined {
  ensureHealthy();
  const record = ticketsById.get(ticketId);
  return record ? publicRecord(record) : undefined;
}

export function resolveHandoff(ticketId: string, actorId: string, summary: string): HandoffRecord | undefined {
  ensureHealthy();
  const prior = ticketsById.get(ticketId);
  if (!prior) return undefined;
  if (prior.status === "resolved") return publicRecord(prior);
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
  return publicRecord(record);
}

export function assertHandoffStoreHealthy(): void {
  ensureHealthy();
  mkdirSync(storeDirectory, { recursive: true, mode: 0o700 });
  const probe = join(storeDirectory, `.handoff-health-${process.pid}`);
  writeFileSync(probe, "ok", { encoding: "utf8", mode: 0o600 });
  rmSync(probe, { force: true });
}

export function activeHandoffTraceIds(): Set<string> {
  ensureHealthy();
  return new Set([...ticketsById.values()]
    .filter((record) => record.status === "open")
    .map((record) => record.traceId));
}

export const fileHandoffRepository: HandoffRepository = {
  create: createHandoff,
  get: getHandoff,
  resolve: resolveHandoff,
  assertHealthy: assertHandoffStoreHealthy,
  activeTraceIds: activeHandoffTraceIds,
};

export function resetHandoffsForTest(): void {
  ticketsByKey.clear();
  ticketsById.clear();
  loaded = true;
  storeFailure = undefined;
  rmSync(storePath, { force: true });
}
