import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateCandidateEvalSuite } from "../evals/lib.ts";
import { parseDecideRequest, validateDecision } from "../src/contract.ts";
import { loadSourceDocuments } from "../src/corpus.ts";
import { decide } from "../src/decide.ts";
import { evidenceForQuote, resolveEvidence } from "../src/evidence.ts";
import { getHandoff, resetHandoffsForTest, resolveHandoff } from "../src/queue.ts";

const input = {
  requestId: "self-check-001",
  question: "Quero que uma pessoa continue este atendimento.",
  asOf: "2026-07-22T09:00:00-03:00",
  requester: {
    subjectId: "COLAB-1042",
    legalEntityId: "NA_SERVICOS",
    baseId: "SUDESTE",
    relationship: "employee",
    role: "consultant",
    domains: ["people_ops"],
  },
};

const parsed = parseDecideRequest(input);
assert.equal(parsed.ok, true, "sample request must satisfy the public contract");
if (!parsed.ok) process.exit(1);

resetHandoffsForTest();
const first = await decide(parsed.value);
const second = await decide(parsed.value);
assert.deepEqual(validateDecision(first), [], "starter decision must satisfy the public contract");
assert.equal(first.kind, "defer", "an explicit human request must create a handoff");
assert.equal(second.kind, "defer");
if (first.kind === "defer" && second.kind === "defer") {
  assert.equal(first.handoff.idempotencyKey, second.handoff.idempotencyKey, "handoff must be idempotent");
  assert.equal(first.handoff.ticketId, second.handoff.ticketId, "retries must reuse the same ticket");
  const stored = getHandoff(first.handoff.ticketId);
  assert.equal(stored?.request.question, input.question, "handoff must preserve the question a person needs");
  assert.equal(stored?.status, "open", "new handoff must be open");
  const resolved = resolveHandoff(first.handoff.ticketId, "self-check-operator", "Validated the next step with the requester.");
  assert.equal(resolved?.status, "resolved", "a person must be able to complete the handoff");
}

const documents = loadSourceDocuments();
assert.equal(documents.length, 34, "candidate corpus must preserve all 34 normalized sources");
assert.equal(new Set(documents.map((document) => document.deliveryFileId)).size, 22, "candidate corpus must preserve all 22 deliveries");
assert.equal(documents.filter((document) => document.sourceType === "faq").length, 13, "candidate corpus must preserve all 13 FAQ categories");
assert.equal(documents.reduce((sum, document) => sum + (document.faqRows ?? 0), 0), 269, "candidate corpus must preserve all 269 FAQ rows");
const manifest = JSON.parse(await readFile(new URL("../case-data/manifest.json", import.meta.url), "utf8")) as { expectedSourceCharacters?: number };
assert.equal(documents.reduce((sum, document) => sum + document.content.length, 0), manifest.expectedSourceCharacters, "candidate corpus source text must be complete");
const document = documents.find((item) => item.content.length >= 24) ?? documents[0];
const quote = document.content.slice(0, 24);
const evidence = evidenceForQuote(document, quote);
assert.equal(resolveEvidence(document, evidence), true, "UTF-8 evidence offsets must resolve exactly");

const discoveryBaseline = JSON.parse(await readFile(new URL("../case-data/client-discovery/service-baseline.json", import.meta.url), "utf8")) as {
  synthetic?: boolean;
  peopleOperationsService?: { monthlyEquivalentAnalystHours?: number };
};
assert.equal(discoveryBaseline.synthetic, true, "discovery measurements must remain explicitly synthetic");
assert.equal(discoveryBaseline.peopleOperationsService?.monthlyEquivalentAnalystHours, 503.2, "discovery baseline must preserve the client pain signal");
const workflowSample = await readFile(new URL("../case-data/client-discovery/workflow-sample.csv", import.meta.url), "utf8");
assert.equal(workflowSample.trim().split(/\r?\n/u).length, 49, "discovery must include 48 noisy request journeys plus its header");
assert.match(workflowSample.split(/\r?\n/u)[0], /channel.*requester_relationship.*documents_opened.*request_excerpt/u, "journey sample must expose operating signals without outcome labels");
assert.doesNotMatch(workflowSample.split(/\r?\n/u)[0], /outcome|resolution_note/u, "journey rows must not expose answer-like labels");
const admissionSnapshot = JSON.parse(await readFile(new URL("../case-data/client-discovery/admission-case-snapshot.json", import.meta.url), "utf8")) as {
  synthetic?: boolean;
  answerEvidenceEligible?: boolean;
  case?: { requestedContext?: unknown; confirmedContext?: unknown; dependencies?: unknown[]; openExceptions?: unknown[] };
  limitations?: string[];
};
assert.equal(admissionSnapshot.synthetic, true, "admission workflow snapshot must remain explicitly synthetic");
assert.equal(admissionSnapshot.answerEvidenceEligible, false, "admission workflow snapshot must never become answer evidence");
assert.ok(admissionSnapshot.case?.requestedContext && admissionSnapshot.case?.confirmedContext, "admission snapshot must expose requested and confirmed state");
assert.ok((admissionSnapshot.case?.dependencies?.length ?? 0) >= 3, "admission snapshot must expose parallel dependencies");
assert.ok((admissionSnapshot.case?.openExceptions?.length ?? 0) >= 2, "admission snapshot must preserve unresolved ownership");
assert.ok((admissionSnapshot.limitations?.length ?? 0) >= 3, "admission snapshot must state its evidentiary limits");
const discoverySessions = JSON.parse(await readFile(new URL("../case-data/client-discovery/discovery-sessions.json", import.meta.url), "utf8")) as {
  synthetic?: boolean;
  answerEvidenceEligible?: boolean;
  provenanceEnvelope?: { reviewedArtifacts?: { callArtifacts?: number; emailArtifacts?: number; collaborationSummaries?: number; memoryRecords?: number; localProjectFiles?: number } };
  sessions?: Array<{ sessionId?: string; observations?: Array<{ type?: string; text?: string }> }>;
  crossSessionTensions?: string[];
  unresolvedQuestions?: string[];
};
assert.equal(discoverySessions.synthetic, true, "session evidence must remain explicitly synthetic");
assert.equal(discoverySessions.answerEvidenceEligible, false, "discovery sessions must never become answer evidence");
assert.deepEqual(discoverySessions.provenanceEnvelope?.reviewedArtifacts, {
  callArtifacts: 15,
  emailArtifacts: 13,
  collaborationSummaries: 2,
  memoryRecords: 1,
  localProjectFiles: 27,
}, "session record must disclose the reviewed discovery envelope");
assert.equal(discoverySessions.sessions?.length, 9, "session record must preserve all nine consolidated discovery moments");
assert.ok((discoverySessions.sessions ?? []).every((session) => session.sessionId && (session.observations?.length ?? 0) >= 3), "each discovery moment needs material evidence");
assert.ok((discoverySessions.crossSessionTensions?.length ?? 0) >= 5, "cross-session contradictions must remain visible");
assert.ok((discoverySessions.unresolvedQuestions?.length ?? 0) >= 5, "discovery must preserve open client questions instead of prescribing the answer");

const evalStarter: unknown = JSON.parse(await readFile(new URL("../evals/cases.json", import.meta.url), "utf8"));
const evalValidation = validateCandidateEvalSuite(evalStarter);
if (evalValidation.summary.candidateCases === 0) {
  assert.equal(evalValidation.summary.sampleCases, 2, "candidate kit must document the eval shape with two samples");
} else {
  assert.deepEqual(evalValidation.errors, [], "a submission eval suite must satisfy the public structural contract");
}

console.log(`Self-check passed: ${documents.length} documents, discovery and admission snapshots present, eval structure checked, contract valid, handoff lifecycle usable, evidence offsets valid.`);
