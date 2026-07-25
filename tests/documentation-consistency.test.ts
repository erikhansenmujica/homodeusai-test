import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RETRIEVAL_LIMITS } from "../src/domain-config.ts";

const operationalDocuments = [
  "../README.md",
  "../ARCHITECTURE.md",
  "../TECHNICAL_DESIGN.md",
  "../RUNBOOK.md",
  "../CLIENT_READOUT.md",
  "../EVAL_REPORT.md",
];

test("evaluation counts, retrieval thresholds, and provider terminology stay consistent", async () => {
  const suite = JSON.parse(await readFile(new URL("../evals/cases.json", import.meta.url), "utf8")) as {
    cases?: unknown[];
  };
  assert.equal(suite.cases?.length, 21);
  assert.equal(RETRIEVAL_LIMITS.minimumTopicCoverage, 0.6);

  const documents = await Promise.all(operationalDocuments.map(async (path) => ({
    path,
    content: await readFile(new URL(path, import.meta.url), "utf8"),
  })));
  const combined = documents.map((document) => document.content).join("\n");
  assert.doesNotMatch(combined, /\b19\/19\b|52%\s+(?:query-concept|subject-term)|provider\.status:\s*["`]?not_used/iu);
  assert.match(combined, /21\/21|21 cases/iu);
  assert.match(combined, /60%\s+(?:topic-coverage|subject-term|subject)/iu);
  assert.match(combined, /`ok`\s+or\s+`degraded`|`ok`\s+ou\s+`degraded`/iu);
  assert.match(combined, /multilingual-e5-base/iu);
  assert.match(combined, /learned retrieval (?:is|as) the (?:selected )?default/iu);
  assert.doesNotMatch(combined, /multilingual-e5-small|21\/21 in both modes|deterministic retrieval (?:is|as) the default/iu);

  for (const document of documents) {
    assert.doesNotMatch(document.content, /provider\.status:\s*["`]?not_used/iu, document.path);
  }

  // Prevent CI from silently exercising learned-mode assertions with the degraded fallback.
  const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  // Require one checksum-verified cache producer before every model-dependent CI job.
  const modelJob = workflow.slice(workflow.indexOf("  model:"), workflow.indexOf("  quality:"));
  assert.match(modelJob, /actions\/cache@v4/u);
  assert.match(modelJob, /npm run setup:model/u);
  assert.match(modelJob, /npm run verify:model/u);
  const modelDependentJobs = [
    ["quality", "browser"],
    ["browser", "evaluations"],
    ["evaluations", "submission"],
    ["container", undefined],
  ] as const;
  for (const [jobName, nextJobName] of modelDependentJobs) {
    const jobStart = workflow.indexOf(`  ${jobName}:`);
    const jobEnd = nextJobName ? workflow.indexOf(`  ${nextJobName}:`, jobStart) : undefined;
    const job = workflow.slice(jobStart, jobEnd);
    assert.match(job, /needs: model/u, `${jobName} must wait for the model cache producer`);
  }
  // Preserve explicit setup verification before the learned quality suite initializes.
  const qualityJob = workflow.slice(workflow.indexOf("  quality:"), workflow.indexOf("  browser:"));
  const modelSetupIndex = qualityJob.indexOf("npm run setup:model");
  const testIndex = qualityJob.indexOf("npm test");
  assert.ok(modelSetupIndex >= 0);
  assert.ok(testIndex >= 0);
  assert.ok(modelSetupIndex < testIndex);
});
