import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseDecideRequest, validateDecision } from "../src/contract.ts";
import { decide } from "../src/decide.ts";
import { getHandoff, resetHandoffsForTest, resolveHandoff } from "../src/queue.ts";

const validRequest = {
  requestId: "request-100",
  question: "Preciso de uma orientação.",
  asOf: "2026-07-22",
  requester: {
    subjectId: "COLAB-1042",
    legalEntityId: "NA_SERVICOS",
    baseId: "SUDESTE",
    relationship: "employee",
    role: "consultant",
    domains: ["people_ops"],
  },
};

test("request parser requires authoritative requester context", () => {
  assert.equal(parseDecideRequest(validRequest).ok, true);
  assert.deepEqual(parseDecideRequest({ question: "oi" }), {
    ok: false,
    errors: ["requestId is required", "asOf must be an ISO date or datetime", "requester is incomplete"],
  });
});

test("decision service returns a valid and idempotent safe handoff", async () => {
  resetHandoffsForTest();
  const parsed = parseDecideRequest(validRequest);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const first = await decide(parsed.value);
  const second = await decide(parsed.value);
  assert.deepEqual(validateDecision(first), []);
  assert.equal(first.kind, "defer");
  assert.deepEqual(first, second);
  if (first.kind !== "defer") return;
  const stored = getHandoff(first.handoff.ticketId);
  assert.equal(stored?.status, "open");
  assert.equal(stored?.request.question, validRequest.question);
  assert.equal(stored?.traceId, first.traceId);
  const resolved = resolveHandoff(first.handoff.ticketId, "operator-17", "Confirmed the supported next step.");
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolveHandoff(first.handoff.ticketId, "different-operator", "Do not overwrite.")?.resolution?.actorId, "operator-17");
});

test("simultaneous duplicate handoffs produce one durable identity", async () => {
  resetHandoffsForTest();
  const parsed = parseDecideRequest({
    ...validRequest,
    requestId: "concurrent-human-request",
    question: "Quero falar com uma pessoa.",
    history: [
      { role: "user", content: "Tenho uma dúvida sobre férias." },
      { role: "assistant", content: "Como posso ajudar?" },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const decisions = await Promise.all([
    decide(parsed.value),
    decide(parsed.value),
    decide(parsed.value),
  ]);
  assert.ok(decisions.every((decision) => decision.kind === "defer"));
  const receipts = decisions.flatMap((decision) =>
    decision.kind === "defer" ? [decision.handoff] : []);
  assert.equal(new Set(receipts.map((receipt) => receipt.ticketId)).size, 1);
  assert.equal(new Set(receipts.map((receipt) => receipt.idempotencyKey)).size, 1);

  const stored = getHandoff(receipts[0]!.ticketId);
  assert.deepEqual(stored?.request.requester, parsed.value.requester);
  assert.deepEqual(stored?.request.history, parsed.value.history);
});

test("simultaneous competing resolutions retain one canonical result", async () => {
  resetHandoffsForTest();
  const parsed = parseDecideRequest({
    ...validRequest,
    requestId: "concurrent-resolution-request",
    question: "Quero falar com uma pessoa.",
    history: [],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const decision = await decide(parsed.value);
  assert.equal(decision.kind, "defer");
  if (decision.kind !== "defer") return;

  const [first, second] = await Promise.all([
    Promise.resolve().then(() =>
      resolveHandoff(decision.handoff.ticketId, "operator-a", "Canonical resolution A.")),
    Promise.resolve().then(() =>
      resolveHandoff(decision.handoff.ticketId, "operator-b", "Competing resolution B.")),
  ]);
  assert.deepEqual(first?.resolution, second?.resolution);
  assert.equal(resolveHandoff(
    decision.handoff.ticketId,
    first!.resolution!.actorId,
    first!.resolution!.summary,
  )?.resolution?.resolvedAt, first?.resolution?.resolvedAt);
});

test("handoff record survives a process restart against the same state directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "gauntlet-handoff-test-"));
  const moduleUrl = new URL("../src/queue.ts", import.meta.url).href;
  const input = JSON.stringify({ ...validRequest, history: [] });
  try {
    const create = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `import { createHandoff } from ${JSON.stringify(moduleUrl)}; const record=createHandoff(${input}, "missing_source", "trace-restart"); process.stdout.write(record.ticketId);`,
    ], { encoding: "utf8", env: { ...process.env, INDEX_PATH: directory } });
    assert.equal(create.status, 0, create.stderr);
    assert.match(create.stdout, /^ticket-[a-f0-9]{12}$/u);

    const retrieve = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `import { getHandoff } from ${JSON.stringify(moduleUrl)}; const record=getHandoff(${JSON.stringify(create.stdout)}); process.stdout.write(JSON.stringify(record));`,
    ], { encoding: "utf8", env: { ...process.env, INDEX_PATH: directory } });
    assert.equal(retrieve.status, 0, retrieve.stderr);
    const record = JSON.parse(retrieve.stdout) as { status?: string; traceId?: string; request?: { question?: string } };
    assert.equal(record.status, "open");
    assert.equal(record.traceId, "trace-restart");
    assert.equal(record.request?.question, validRequest.question);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("public decision contract rejects fractional handoff SLAs and prefixed hashes", () => {
  const defer = {
    kind: "defer",
    answerabilityScore: 0.2,
    userMessage: "A person will review this.",
    handoff: { ticketId: "ticket", reasonCode: "missing_source", queue: "knowledge_governance", slaHours: 0.5, idempotencyKey: "idem" },
    traceId: "trace-defer",
  };
  assert.ok(validateDecision(defer).includes("defer.handoff.slaHours must be a positive integer"));

  const answer = {
    kind: "answer",
    answerabilityScore: 0.9,
    body: "Supported.",
    claims: [{ id: "claim", text: "Supported.", evidence: [{ sourceId: "source", versionId: "1", startByte: 0, endByte: 1, quote: "x", quoteSha256: `sha256:${"a".repeat(64)}` }] }],
    traceId: "trace-answer",
  };
  assert.ok(validateDecision(answer).some((error) => error.includes("quoteSha256")));
});
