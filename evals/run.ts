import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveTrustedProfile,
  validateCandidateEvalSuite,
  validateTrustedProfileSurface,
  type CandidateEvalCase,
} from "./lib.ts";
import { validateDecision } from "../src/contract.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = (process.env.CANDIDATE_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/u, "");
const reportPath = resolve(process.env.CANDIDATE_EVAL_REPORT_PATH ?? "/tmp/candidate-eval-report.json");
const suitePath = resolve(process.env.CANDIDATE_EVAL_SUITE_PATH ?? `${root}/evals/cases.json`);
const suiteInput: unknown = JSON.parse(await readFile(suitePath, "utf8"));
const validation = validateCandidateEvalSuite(suiteInput);
const MAX_RESPONSE_BYTES = 256 * 1024;

type SourceDocument = {
  sourceId: string;
  versionId: string;
  domain: string;
  content: string;
};

type EvalResult = {
  id: string;
  expectedKind: string;
  observedKind: string | null;
  latencyMs: number | null;
  checks: Record<string, boolean>;
  errors: string[];
  passed: boolean;
};

function normalize(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("pt-BR");
}

function decisionBody(decision: Record<string, unknown>): string {
  if (decision.kind === "answer" || decision.kind === "conversational") return String(decision.body ?? "");
  if (decision.kind === "defer") return String(decision.userMessage ?? "");
  return "";
}

type ObservedClaim = { text: string; evidence: Array<{ sourceId: string; quote: string }> };

function evidenceChecks(decision: Record<string, unknown>, documents: Map<string, SourceDocument>): { valid: boolean; sources: Set<string>; claims: ObservedClaim[] } {
  if (decision.kind !== "answer" || !Array.isArray(decision.claims)) return { valid: false, sources: new Set(), claims: [] };
  const sources = new Set<string>();
  const claims: ObservedClaim[] = [];
  let valid = decision.claims.length > 0 && decision.claims.length <= 64;
  for (const claim of decision.claims.slice(0, 64)) {
    if (!claim || typeof claim !== "object" || !Array.isArray((claim as { evidence?: unknown }).evidence)) {
      valid = false;
      continue;
    }
    const observedClaim: ObservedClaim = { text: String((claim as { text?: unknown }).text ?? ""), evidence: [] };
    const evidence = (claim as { evidence: unknown[] }).evidence;
    if (evidence.length === 0 || evidence.length > 16) valid = false;
    for (const item of evidence.slice(0, 16)) {
      if (!item || typeof item !== "object") {
        valid = false;
        continue;
      }
      const value = item as Record<string, unknown>;
      const sourceId = String(value.sourceId ?? "");
      const document = documents.get(sourceId);
      const start = Number(value.startByte);
      const end = Number(value.endByte);
      if (!document || document.versionId !== value.versionId || !Number.isInteger(start) || !Number.isInteger(end)) {
        valid = false;
        continue;
      }
      const bytes = Buffer.from(document.content, "utf8");
      if (start < 0 || end <= start || end > bytes.length) {
        valid = false;
        continue;
      }
      const quoteBytes = bytes.subarray(start, end);
      const quote = quoteBytes.toString("utf8");
      const hash = createHash("sha256").update(quoteBytes).digest("hex");
      const roundTrips = Buffer.from(quote, "utf8").equals(quoteBytes);
      if (!roundTrips || quote !== value.quote || hash !== value.quoteSha256) valid = false;
      sources.add(sourceId);
      observedClaim.evidence.push({ sourceId, quote });
    }
    claims.push(observedClaim);
  }
  return { valid, sources, claims };
}

function requiredClaimSupport(testCase: CandidateEvalCase, claims: ObservedClaim[]): boolean {
  return (testCase.expected.requiredClaims ?? []).every((requirement) => {
    const bodyTerm = normalize(requirement.bodyTerm);
    return claims.some((claim) => (
      normalize(claim.text).includes(bodyTerm) &&
      claim.evidence.some((evidence) => (
        requirement.sourceIds.includes(evidence.sourceId) &&
        requirement.quoteTerms.every((term) => normalize(evidence.quote).includes(normalize(term)))
      ))
    ));
  });
}

function evaluateDecision(testCase: CandidateEvalCase, decision: unknown, latencyMs: number, documents: Map<string, SourceDocument>): EvalResult {
  const errors: string[] = [];
  const checks: Record<string, boolean> = {};
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return { id: testCase.id, expectedKind: testCase.expected.kind, observedKind: null, latencyMs, checks, errors: ["response was not a decision object"], passed: false };
  }
  const value = decision as Record<string, unknown>;
  const contractErrors = validateDecision(decision);
  const observedKind = typeof value.kind === "string" ? value.kind : null;
  checks.contract = contractErrors.length === 0;
  checks.kind = observedKind === testCase.expected.kind;
  checks.trace = typeof value.traceId === "string" && value.traceId.length > 0;
  checks.latency = latencyMs <= (testCase.expected.maxLatencyMs ?? 20_000);
  const body = normalize(decisionBody(value));
  checks.requiredBodyTerms = (testCase.expected.requiredBodyTerms ?? []).every((term) => body.includes(normalize(term)));
  checks.forbiddenBodyTerms = (testCase.expected.forbiddenBodyTerms ?? []).every((term) => !body.includes(normalize(term)));

  if (testCase.expected.kind === "answer") {
    const evidence = evidenceChecks(value, documents);
    checks.evidenceIntegrity = evidence.valid;
    checks.requiredSources = (testCase.expected.requiredSourceIds ?? []).every((sourceId) => evidence.sources.has(sourceId));
    checks.claimSupport = requiredClaimSupport(testCase, evidence.claims);
  }
  if (testCase.expected.kind === "defer") {
    const handoff = value.handoff && typeof value.handoff === "object" ? value.handoff as Record<string, unknown> : {};
    checks.reasonCode = handoff.reasonCode === testCase.expected.reasonCode;
    checks.handoffIdentity = [handoff.ticketId, handoff.idempotencyKey, handoff.queue].every((entry) => typeof entry === "string" && entry.length > 0);
  }
  if (testCase.expected.kind === "conversational") checks.body = body.length > 0;

  if (contractErrors.length > 0) errors.push(...contractErrors.map((error) => `contract: ${error}`));
  for (const [check, passed] of Object.entries(checks)) if (!passed && check !== "contract") errors.push(check);
  return { id: testCase.id, expectedKind: testCase.expected.kind, observedKind, latencyMs, checks, errors, passed: errors.length === 0 };
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(22_000) });
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("response exceeded 256 KiB");
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("response exceeded 256 KiB");
      }
      chunks.push(value);
    }
  }
  const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8");
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 200)}`);
  return parsed;
}

const results: EvalResult[] = [];
if (validation.errors.length === 0 && validation.suite) {
  const [profilePayload, documentPayload] = await Promise.all([
    requestJson("/api/profiles"),
    readFile(resolve(root, "case-data/source-documents.json"), "utf8").then((raw) => JSON.parse(raw) as unknown),
  ]);
  const profileSurfaceErrors = validateTrustedProfileSurface(profilePayload);
  const documentRows = Array.isArray(documentPayload) ? documentPayload as SourceDocument[] : [];
  const documents = new Map(documentRows.map((document) => [document.sourceId, document]));

  const expectedSourceIds = new Set(validation.suite.cases.filter((testCase) => testCase.sample !== true).flatMap((testCase) => testCase.expected.requiredSourceIds ?? []));
  for (const sourceId of expectedSourceIds) {
    if (!documents.has(sourceId)) validation.errors.push(`candidate eval references unknown source ID: ${sourceId}`);
  }
  const expectedDomains = new Set([...expectedSourceIds].map((sourceId) => documents.get(sourceId)?.domain).filter((domain): domain is string => Boolean(domain)));
  if (expectedSourceIds.size > 0 && expectedDomains.size < 3) validation.errors.push("candidate answer cases must span at least 3 source domains");

  for (const [index, testCase] of validation.errors.length === 0 ? validation.suite.cases.entries() : []) {
    const profile = resolveTrustedProfile(testCase.profileId);
    if (!profile) {
      results.push({ id: testCase.id, expectedKind: testCase.expected.kind, observedKind: null, latencyMs: null, checks: {}, errors: [`unknown profileId: ${testCase.profileId}`], passed: false });
      continue;
    }
    const started = performance.now();
    try {
      const decision = await requestJson("/v1/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: `candidate-eval-${index}-${testCase.id}`,
          question: testCase.question,
          asOf: testCase.asOf,
          requester: {
            subjectId: `candidate-eval-${profile.profileId}`,
            legalEntityId: profile.legalEntityId,
            baseId: profile.baseId,
            relationship: profile.relationship,
            role: profile.role,
            domains: [],
          },
          history: testCase.history ?? [],
        }),
      });
      results.push(evaluateDecision(testCase, decision, performance.now() - started, documents));
    } catch (error) {
      results.push({
        id: testCase.id,
        expectedKind: testCase.expected.kind,
        observedKind: null,
        latencyMs: performance.now() - started,
        checks: {},
        errors: [error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)],
        passed: false,
      });
    }
  }
  validation.errors.push(...profileSurfaceErrors);
}

const passedCases = results.filter((result) => result.passed).length;
const executionComplete = validation.errors.length === 0 && Boolean(validation.suite) &&
  results.length === (validation.suite?.cases.length ?? 0);
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  baseUrl,
  suitePath,
  suite: validation.summary,
  suiteErrors: validation.errors,
  results,
  totals: { cases: results.length, passed: passedCases, failed: results.length - passedCases },
  passRate: results.length > 0 ? passedCases / results.length : 0,
  executionComplete,
  passed: executionComplete && results.length > 0 && passedCases === results.length,
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ reportPath, suite: report.suite, totals: report.totals, passRate: report.passRate, executionComplete: report.executionComplete, passed: report.passed, suiteErrors: report.suiteErrors }, null, 2)}\n`);
if (!report.executionComplete) process.exitCode = 1;
