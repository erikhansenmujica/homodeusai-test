import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadSourceDocuments } from "../src/corpus.ts";
import { decide } from "../src/decide.ts";
import { resolveEvidence } from "../src/evidence.ts";
import { getTrace } from "../src/traces.ts";

type ExtendedCase = {
  id: number;
  profileId: string;
  question: string;
  asOf?: string;
  expectedKind: "answer" | "defer" | "conversational";
  reasonCodes?: string[];
  bodyTerms?: string[];
  forbiddenTerms?: string[];
  sourceIds?: string[];
  sourceMatch?: "all" | "any";
};

type TrustedProfile = {
  profileId: string;
  legalEntityId: string;
  baseId: string;
  relationship: string;
  role: string;
};

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("pt-BR");
}

const fixture = JSON.parse(
  await readFile(new URL("./extended-cases.json", import.meta.url), "utf8"),
) as { schemaVersion: string; cases: ExtendedCase[] };
const profilePayload = JSON.parse(
  await readFile(new URL("../case-data/actors/profiles.json", import.meta.url), "utf8"),
) as { profiles: TrustedProfile[] };
const profiles = new Map(profilePayload.profiles.map((profile) => [profile.profileId, profile]));
const documents = new Map(loadSourceDocuments().map((document) => [document.sourceId, document]));

test("the supplied 63-question adversarial matrix remains governed and semantically correct", async (context) => {
  assert.equal(fixture.schemaVersion, "1.0");
  assert.equal(fixture.cases.length, 63);
  assert.equal(new Set(fixture.cases.map((testCase) => testCase.id)).size, 63);

  for (const testCase of fixture.cases) {
    await context.test(`${testCase.id}: ${testCase.question}`, async () => {
      const profile = profiles.get(testCase.profileId);
      assert.ok(profile, `unknown profile: ${testCase.profileId}`);
      const decision = await decide({
        requestId: `extended-${testCase.id}-${Date.now()}`,
        question: testCase.question,
        asOf: testCase.asOf ?? "2026-07-22T10:30:00.000Z",
        requester: {
          subjectId: `extended-${testCase.profileId}`,
          legalEntityId: profile.legalEntityId,
          baseId: profile.baseId,
          relationship: profile.relationship,
          role: profile.role,
          domains: [],
        },
        history: [],
      });

      assert.equal(decision.kind, testCase.expectedKind);
      if (decision.kind === "defer" && testCase.reasonCodes?.length) {
        assert.ok(testCase.reasonCodes.includes(decision.handoff.reasonCode), decision.handoff.reasonCode);
      }

      const body = decision.kind === "defer" ? decision.userMessage : decision.body;
      for (const term of testCase.bodyTerms ?? []) {
        assert.ok(normalized(body).includes(normalized(term)), `missing body term: ${term}`);
      }
      for (const term of testCase.forbiddenTerms ?? []) {
        assert.ok(!normalized(JSON.stringify(decision)).includes(normalized(term)), `leaked forbidden term: ${term}`);
      }
      const trace = getTrace(decision.traceId);
      assert.ok(trace, decision.traceId);
      for (const term of testCase.forbiddenTerms ?? []) {
        assert.ok(
          !normalized(JSON.stringify(trace)).includes(normalized(term)),
          `trace leaked forbidden term: ${term}`,
        );
      }

      if (decision.kind !== "answer") return;
      const observedSourceIds = new Set(decision.claims.flatMap((claim) =>
        claim.evidence.map((evidence) => evidence.sourceId)));
      if ((testCase.sourceIds?.length ?? 0) > 0) {
        const matches = testCase.sourceIds!.filter((sourceId) => observedSourceIds.has(sourceId));
        assert.ok(
          testCase.sourceMatch === "any"
            ? matches.length > 0
            : matches.length === testCase.sourceIds!.length,
          `unexpected sources: ${[...observedSourceIds].join(", ")}`,
        );
      }
      for (const claim of decision.claims) {
        for (const evidence of claim.evidence) {
          const document = documents.get(evidence.sourceId);
          assert.ok(document, evidence.sourceId);
          assert.equal(resolveEvidence(document!, evidence), true);
        }
      }
    });
  }
});
