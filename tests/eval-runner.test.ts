import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("candidate eval runner exercises answer, defer, conversation, and evidence checks end to end", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "gauntlet-eval-runner-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const documents = JSON.parse(await readFile(join(root, "case-data/source-documents.json"), "utf8")) as Array<{
    sourceId: string;
    versionId: string;
    domain: string;
    content: string;
  }>;
  const trustedProfilePayload = JSON.parse(await readFile(join(root, "case-data/actors/profiles.json"), "utf8")) as {
    schemaVersion: number;
    profiles: Array<{
      profileId: string;
      legalEntityId: string;
      baseId: string;
      relationship: string;
      role: string;
      audiences: string[];
    }>;
  };
  const trustedProfiles = new Map(trustedProfilePayload.profiles.map((profile) => [profile.profileId, profile]));
  const selectedDocuments: typeof documents = [];
  const selectedDomains = new Set<string>();
  for (const document of documents) {
    if (selectedDomains.has(document.domain)) continue;
    selectedDocuments.push(document);
    selectedDomains.add(document.domain);
    if (selectedDocuments.length === 4) break;
  }
  assert.equal(selectedDocuments.length, 4);
  const evidenceBySource = new Map(selectedDocuments.map((document) => {
    const quote = document.content.slice(0, 96);
    const quoteBytes = Buffer.from(quote, "utf8");
    return [document.sourceId, {
      sourceId: document.sourceId,
      versionId: document.versionId,
      startByte: 0,
      endByte: quoteBytes.length,
      quote,
      quoteSha256: createHash("sha256").update(quoteBytes).digest("hex"),
    }];
  }));
  const document = selectedDocuments[0];
  const documentBytes = Buffer.from(document.content, "utf8");
  const accentedCharacter = document.content.indexOf("É");
  assert.ok(accentedCharacter > 0);
  const accentedStartByte = Buffer.byteLength(document.content.slice(0, accentedCharacter), "utf8");
  const malformedBytes = documentBytes.subarray(accentedStartByte, accentedStartByte + 1);
  const midCodepointEvidence = {
    sourceId: document.sourceId,
    versionId: document.versionId,
    startByte: accentedStartByte,
    endByte: accentedStartByte + 1,
    quote: malformedBytes.toString("utf8"),
    quoteSha256: createHash("sha256").update(malformedBytes).digest("hex"),
  };

  const sourcePairs = [selectedDocuments.slice(0, 2).map((item) => item.sourceId), selectedDocuments.slice(2, 4).map((item) => item.sourceId)];
  const cases = Array.from({ length: 12 }, (_, index) => {
    const kind = index < 4 ? "answer" : index < 8 ? "defer" : "conversational";
    const tags = index < 2
      ? [kind, "multi_source"]
      : index === 2
        ? [kind]
      : index === 3
        ? [kind, "counterfactual_boundary"]
        : index < 6
          ? [kind, "governance", "privacy_or_injection"]
          : index === 6
            ? [kind, "missing_evidence"]
            : index === 7
              ? [kind, "missing_evidence", "counterfactual_boundary"]
              : index < 10
                ? [kind, "paraphrase_or_boundary"]
                : [kind, "candidate_priority"];
    const requiredSourceIds = sourcePairs[index < 2 ? 0 : 1];
    return {
      id: `runner-${index}`,
      objective: `Exercise a consequential ${kind} path through the candidate eval runner.`,
      clusterId: index < 2 ? "repeat-a" : [3, 7].includes(index) ? "scope-boundary" : index < 10 && index >= 8 ? "conversation-repeat" : `cluster-${index}`,
      profileId: index === 7 ? "employee-na-servicos-centro-oeste" : "employee-na-servicos-sudeste",
      question: [3, 7].includes(index) ? "Which governed rule applies to this requester?" : `Runner case ${index}`,
      asOf: "2026-07-22T10:30:00.000Z",
      tags,
      expected: kind === "answer"
        ? {
            kind,
            requiredSourceIds,
            requiredBodyTerms: ["supported fact"],
            requiredClaims: [{ bodyTerm: "supported fact", sourceIds: requiredSourceIds, quoteTerms: ["documento sintético"] }],
          }
        : kind === "defer"
          ? { kind, reasonCode: index < 6 ? "policy_sensitive_source" : "missing_source" }
          : { kind },
    };
  });
  const suitePath = join(temporaryRoot, "cases.json");
  const reportPath = join(temporaryRoot, "report.json");
  await writeFile(suitePath, JSON.stringify({ schemaVersion: "1.0", cases }), "utf8");

  let responseMode: "valid" | "invalid-contract" | "mid-codepoint" | "oversized" | "remapped-profile" = "valid";
  const decideRequests: Array<{
    requestId: string;
    requester: {
      legalEntityId: string;
      baseId: string;
      relationship: string;
      role: string;
    };
  }> = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/api/profiles") {
      const payload = responseMode === "remapped-profile"
        ? {
            ...trustedProfilePayload,
            profiles: trustedProfilePayload.profiles.map((profile) => profile.profileId === "employee-na-servicos-centro-oeste"
              ? { ...profile, baseId: "SUDESTE" }
              : profile),
          }
        : trustedProfilePayload;
      response.end(JSON.stringify(payload));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/decide") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as (typeof decideRequests)[number];
      decideRequests.push(payload);
      const index = Number(payload.requestId.split("-")[2]);
      const traceId = `trace-${index}`;
      if (responseMode === "oversized" && index === 0) {
        response.setHeader("content-length", String(2 * 1024 * 1024 + 1));
        response.end("{}");
        return;
      }
      if (index < 4) {
        const requiredSources = sourcePairs[index < 2 ? 0 : 1];
        const answerEvidence = requiredSources.map((sourceId) => evidenceBySource.get(sourceId));
        if (responseMode === "mid-codepoint") answerEvidence[0] = midCodepointEvidence;
        const answer: Record<string, unknown> = {
          kind: "answer",
          answerabilityScore: 0.95,
          body: "Supported fact from the governed record.",
          claims: [{
            id: `claim-${index}`,
            text: "Supported fact from the governed record.",
            evidence: answerEvidence,
          }],
          traceId,
        };
        if (responseMode === "invalid-contract") {
          delete answer.answerabilityScore;
          answer.claims = [{ evidence: answerEvidence }];
        }
        response.end(JSON.stringify(answer));
      } else if (index < 8) {
        const defer: Record<string, unknown> = {
          kind: "defer",
          answerabilityScore: 0.2,
          userMessage: "A person will review this request.",
          handoff: {
            ticketId: `ticket-${index}`,
            reasonCode: index < 6 ? "policy_sensitive_source" : "missing_source",
            queue: index < 6 ? "people_ops_lead" : "knowledge_governance",
            slaHours: 24,
            idempotencyKey: `idem-${index}`,
          },
          traceId,
        };
        if (responseMode === "invalid-contract") {
          delete defer.userMessage;
          const handoff = defer.handoff as Record<string, unknown>;
          delete handoff.slaHours;
        }
        response.end(JSON.stringify(defer));
      } else {
        response.end(JSON.stringify({ kind: "conversational", body: "Olá. Como posso ajudar?", traceId }));
      }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const runRunner = (outputPath: string) => execFileAsync(process.execPath, ["evals/run.ts"], {
    cwd: root,
    env: {
      ...process.env,
      CANDIDATE_BASE_URL: `http://127.0.0.1:${address.port}`,
      CANDIDATE_EVAL_SUITE_PATH: suitePath,
      CANDIDATE_EVAL_REPORT_PATH: outputPath,
    },
  });

  await runRunner(reportPath);

  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    passed: boolean;
    suite: { candidateCases: number };
    totals: { cases: number; passed: number; failed: number };
  };
  assert.equal(report.passed, true);
  assert.equal(report.suite.candidateCases, 12);
  assert.deepEqual(report.totals, { cases: 12, passed: 12, failed: 0 });

  responseMode = "invalid-contract";
  const invalidContractReportPath = join(temporaryRoot, "invalid-contract-report.json");
  await runRunner(invalidContractReportPath);
  const invalidContractReport = JSON.parse(await readFile(invalidContractReportPath, "utf8")) as {
    totals: { passed: number; failed: number };
    results: Array<{ checks: Record<string, boolean>; errors: string[] }>;
  };
  assert.deepEqual(invalidContractReport.totals, { cases: 12, passed: 4, failed: 8 });
  assert.equal(invalidContractReport.results.slice(0, 8).every((result) => result.checks.contract === false && result.errors.some((error) => error.startsWith("contract:"))), true);

  responseMode = "mid-codepoint";
  const midCodepointReportPath = join(temporaryRoot, "mid-codepoint-report.json");
  await runRunner(midCodepointReportPath);
  const midCodepointReport = JSON.parse(await readFile(midCodepointReportPath, "utf8")) as {
    totals: { passed: number; failed: number };
    results: Array<{ checks: Record<string, boolean> }>;
  };
  assert.deepEqual(midCodepointReport.totals, { cases: 12, passed: 8, failed: 4 });
  assert.equal(midCodepointReport.results.slice(0, 4).every((result) => result.checks.evidenceIntegrity === false), true);

  responseMode = "oversized";
  const oversizedReportPath = join(temporaryRoot, "oversized-report.json");
  await runRunner(oversizedReportPath);
  const oversizedReport = JSON.parse(await readFile(oversizedReportPath, "utf8")) as {
    totals: { passed: number; failed: number };
    results: Array<{ errors: string[] }>;
  };
  assert.deepEqual(oversizedReport.totals, { cases: 12, passed: 11, failed: 1 });
  assert.match(oversizedReport.results[0].errors[0], /response exceeded 256 KiB/u);

  responseMode = "remapped-profile";
  const remappedStart = decideRequests.length;
  const remappedProfileReportPath = join(temporaryRoot, "remapped-profile-report.json");
  await assert.rejects(() => runRunner(remappedProfileReportPath));
  const remappedProfileReport = JSON.parse(await readFile(remappedProfileReportPath, "utf8")) as {
    executionComplete: boolean;
    suiteErrors: string[];
    totals: { cases: number; passed: number; failed: number };
  };
  const remappedRequests = decideRequests.slice(remappedStart);
  assert.equal(remappedRequests.length, cases.length);
  for (const request of remappedRequests) {
    const index = Number(request.requestId.split("-")[2]);
    const trusted = trustedProfiles.get(cases[index].profileId);
    assert.ok(trusted);
    assert.deepEqual(request.requester, {
      subjectId: `candidate-eval-${trusted.profileId}`,
      legalEntityId: trusted.legalEntityId,
      baseId: trusted.baseId,
      relationship: trusted.relationship,
      role: trusted.role,
      domains: [],
    });
  }
  assert.equal(remappedProfileReport.executionComplete, false);
  assert.ok(remappedProfileReport.suiteErrors.includes(
    "profile registry profile employee-na-servicos-centro-oeste does not match pinned baseId",
  ));
  assert.deepEqual(remappedProfileReport.totals, { cases: 12, passed: 12, failed: 0 });
});
