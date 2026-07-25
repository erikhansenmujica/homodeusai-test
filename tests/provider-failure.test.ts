import assert from "node:assert/strict";
import test from "node:test";
import { withProviderFailureBoundary } from "../src/decide.ts";
import { SemanticProviderUnavailableError } from "../src/runtime.ts";
import { getHandoff, resetHandoffsForTest } from "../src/queue.ts";
import { getTrace } from "../src/traces.ts";
import type { DecideRequest } from "../src/types.ts";

const request: DecideRequest = {
  requestId: "provider-outage-request",
  question: "Com quantos dias de antecedência devo solicitar férias?",
  asOf: "2026-07-24T12:00:00.000Z",
  requester: {
    subjectId: "provider-outage-user",
    legalEntityId: "NA_SERVICOS",
    baseId: "SUDESTE",
    relationship: "employee",
    role: "colaborador",
    domains: [],
  },
  history: [],
};

test("a request-time semantic provider outage becomes a governed provider_failure handoff", async () => {
  resetHandoffsForTest();
  const decision = await withProviderFailureBoundary(request, async () => {
    throw new SemanticProviderUnavailableError("test provider request");
  });

  assert.equal(decision.kind, "defer");
  if (decision.kind !== "defer") return;
  assert.equal(decision.handoff.reasonCode, "provider_failure");
  assert.equal(decision.handoff.queue, "people_ops_triage");
  assert.equal(decision.handoff.slaHours, 4);

  const handoff = getHandoff(decision.handoff.ticketId);
  assert.deepEqual(handoff?.request.requester, request.requester);
  assert.deepEqual(handoff?.request.history, request.history);

  const trace = getTrace(decision.traceId);
  assert.equal(trace?.route.reasonCode, "provider_failure");
  assert.equal(trace?.provider.status, "degraded");
  assert.equal(trace?.consideredEvidence.length, 0);
});

test("the provider boundary does not hide unrelated implementation failures", async () => {
  await assert.rejects(
    withProviderFailureBoundary(request, async () => {
      throw new TypeError("programming defect");
    }),
    /programming defect/u,
  );
});
