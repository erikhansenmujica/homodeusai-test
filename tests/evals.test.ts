import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  resolveTrustedProfile,
  validateCandidateEvalSuite,
  validateTrustedProfileSurface,
} from "../evals/lib.ts";

function completeSuite(): unknown {
  const sourcePairs = [["source-payroll", "source-policy"], ["source-faq", "source-process"]];
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
      id: `candidate-${index}`,
      objective: `Test a consequential ${kind} boundary in the client workflow.`,
      clusterId: index < 2 ? "fact-a" : [3, 7].includes(index) ? "scope-boundary" : index < 10 && index >= 8 ? "conversation-repeat" : `fact-${index}`,
      profileId: index === 7 ? "employee-na-servicos-centro-oeste" : "employee-na-servicos-sudeste",
      question: [3, 7].includes(index) ? "Which governed rule applies to this requester?" : `Question ${index}`,
      asOf: "2026-07-22T10:30:00.000Z",
      tags,
      expected: kind === "answer"
        ? {
            kind,
            requiredSourceIds,
            requiredBodyTerms: ["required fact"],
            requiredClaims: [{ bodyTerm: "required fact", sourceIds: requiredSourceIds, quoteTerms: ["supporting passage"] }],
          }
        : kind === "defer"
          ? { kind, reasonCode: index < 6 ? "policy_sensitive_source" : "missing_source" }
          : { kind },
    };
  });
  return { schemaVersion: "1.0", cases };
}

test("candidate eval validator accepts the documented minimum risk coverage", () => {
  const result = validateCandidateEvalSuite(completeSuite());
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.candidateCases, 12);
  assert.equal(result.summary.expectedKinds.answer, 4);
  assert.equal(result.summary.expectedKinds.defer, 4);
  assert.equal(result.summary.repeatedClusters, 2);
  assert.equal(result.summary.candidateDefinedCases, 2);
});

test("candidate eval validator bounds suite execution work", () => {
  const input = completeSuite() as { schemaVersion: "1.0"; cases: Array<Record<string, unknown>> };
  while (input.cases.length < 49) {
    const index = input.cases.length;
    input.cases.push({ ...input.cases[0], id: `extra-${index}`, clusterId: `extra-${index}` });
  }
  assert.ok(validateCandidateEvalSuite(input).errors.includes("suite may contain at most 48 non-sample cases"));
});

test("candidate eval risk tags must describe the mechanics of the case", () => {
  const input = completeSuite() as { schemaVersion: "1.0"; cases: Array<Record<string, any>> };
  input.cases[0].tags = ["answer", "multi_source", "governance", "missing_evidence", "privacy_or_injection", "paraphrase_or_boundary"];
  input.cases[0].expected.requiredSourceIds = ["source-payroll"];
  const errors = validateCandidateEvalSuite(input).errors;
  assert.ok(errors.some((error) => error.includes("at most 2 required risk tags")));
  assert.ok(errors.some((error) => error.includes("multi_source without requiring an answer from at least 2 sources")));
  assert.ok(errors.some((error) => error.includes("governance without a governance-specific deferral")));
  assert.ok(errors.some((error) => error.includes("missing_evidence without a missing_source deferral")));
  assert.ok(errors.some((error) => error.includes("privacy_or_injection without a privacy-safe deferral")));
});

test("counterfactual profile pairs must change exactly one resolved trusted axis", () => {
  const input = completeSuite() as { schemaVersion: "1.0"; cases: Array<Record<string, any>> };
  input.cases[7].profileId = "external-candidate";
  const errors = validateCandidateEvalSuite(input).errors;
  assert.ok(errors.some((error) => error.includes("exactly one trusted profile axis")));
});

test("trusted profile resolution ignores a remapped product surface", async () => {
  const payload = JSON.parse(await readFile(new URL("../case-data/actors/profiles.json", import.meta.url), "utf8")) as {
    profiles: Array<Record<string, unknown>>;
  };
  const remapped = structuredClone(payload);
  const row = remapped.profiles.find((profile) => profile.profileId === "employee-na-servicos-centro-oeste");
  assert.ok(row);
  row.baseId = "SUDESTE";

  assert.deepEqual(resolveTrustedProfile("employee-na-servicos-centro-oeste"), {
    profileId: "employee-na-servicos-centro-oeste",
    legalEntityId: "NA_SERVICOS",
    baseId: "CENTRO_OESTE",
    relationship: "employee",
    role: "colaborador",
    audiences: ["employee"],
  });
  assert.ok(validateTrustedProfileSurface(remapped).includes(
    "profile registry profile employee-na-servicos-centro-oeste does not match pinned baseId",
  ));
});

test("authored eval suite satisfies the submission structure", async () => {
  const input: unknown = JSON.parse(await readFile(new URL("../evals/cases.json", import.meta.url), "utf8"));
  const result = validateCandidateEvalSuite(input);
  assert.equal(result.summary.sampleCases, 0);
  assert.equal(result.summary.candidateCases, 19);
  assert.deepEqual(result.errors, []);
});
