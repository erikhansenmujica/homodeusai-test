import assert from "node:assert/strict";
import test from "node:test";
import { loadSourceDocuments } from "../src/corpus.ts";
import { getGovernedSource } from "../src/source-access.ts";

const employeeContext = {
  profileId: "employee-na-servicos-sudeste",
  asOf: "2026-07-22T12:00:00.000Z",
};

test("governed source access exposes only eligible normalized content", () => {
  const source = loadSourceDocuments().find((document) => document.sourceId === "na-faq-payroll-v1");
  assert.ok(source);
  const result = getGovernedSource(source.sourceId, source.versionId, employeeContext);
  assert.equal(result?.access, "available");
  if (!result || result.access !== "available") return;
  assert.equal(result.content, source.content);
  assert.equal(result.metadata.title, source.title);
  assert.equal(result.metadata.contentBytes, Buffer.byteLength(source.content, "utf8"));
});

test("internal, sensitive, pending, rejected, and out-of-scope source bodies never cross the API boundary", () => {
  const cases = [
    ["na-compensation-professional-2025", "2025.10"],
    ["na-people-ops-process-map-r7", "7-extract"],
    ["na-onboarding-briefing-v7", "7-draft"],
  ] as const;
  for (const [sourceId, versionId] of cases) {
    const source = loadSourceDocuments().find((document) => (
      document.sourceId === sourceId && document.versionId === versionId
    ));
    assert.ok(source);
    const result = getGovernedSource(sourceId, versionId, employeeContext);
    assert.equal(result?.access, "restricted", sourceId);
    assert.ok(result && !("content" in result), sourceId);
    assert.equal(JSON.stringify(result).includes(source.content.slice(0, 80)), false, sourceId);
  }

  const scopedSource = loadSourceDocuments().find((document) => (
    document.sourceId === "na-agreement-metropolitan-2025"
  ));
  assert.ok(scopedSource);
  const scopedResult = getGovernedSource(scopedSource.sourceId, scopedSource.versionId, {
    profileId: "employee-na-servicos-centro-oeste",
    asOf: employeeContext.asOf,
  });
  assert.equal(scopedResult?.access, "restricted");
  assert.ok(scopedResult && !("content" in scopedResult));
});

test("invalid trusted context returns safe metadata without protected content", () => {
  const result = getGovernedSource(
    "na-faq-payroll-v1",
    "1.0",
    { profileId: "unknown-profile", asOf: employeeContext.asOf },
  );
  assert.equal(result?.access, "restricted");
  assert.deepEqual(result?.access === "restricted" ? result.restrictionReasons : [], ["trusted_context"]);
  assert.ok(result && !("content" in result));
});
