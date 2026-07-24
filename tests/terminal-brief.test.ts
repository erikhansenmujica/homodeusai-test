import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderWorkbench } from "../src/ui.ts";

test("finished workbench exposes the production decision path", () => {
  const html = renderWorkbench();
  for (const testId of [
    "decision-workbench", "request-form", "question-input", "submit-decision",
    "decision-history", "decision-result", "source-inventory", "source-detail", "error-state",
  ]) {
    assert.match(html, new RegExp(`data-testid="${testId}"`, "u"), `missing production hook: ${testId}`);
  }
  assert.match(html, /Respostas com <em>recibo/iu);
  assert.match(html, /aria-busy="false"/u);
  assert.doesNotMatch(html, /gauntlet-starter|data-starter="incomplete"/u);
});

test("workbench implements evidence, trace, and handoff lifecycle surfaces", () => {
  const html = renderWorkbench();
  for (const testId of [
    "claims-panel", "evidence-source-link", "handoff-panel", "handoff-open",
    "handoff-record", "handoff-resolution-form", "handoff-resolution-summary",
    "handoff-resolve", "handoff-resolved-state", "trace-trigger", "trace-panel",
  ]) {
    assert.match(html, new RegExp(`"${testId}"`, "u"), `missing lifecycle hook: ${testId}`);
  }
  assert.match(html, /requestSubmit\(\)/u);
  assert.match(html, /sourceId \+ " · " \+ evidence.versionId/u);
  assert.match(html, /trusted requester does not|Limite de confiança/iu);
});

test("candidate guides define the same three-part final review", async () => {
  const [caseBrief, evaluation, submission] = await Promise.all([
    readFile(new URL("../CASE.md", import.meta.url), "utf8"),
    readFile(new URL("../EVALUATION.md", import.meta.url), "utf8"),
    readFile(new URL("../SUBMISSION.md", import.meta.url), "utf8"),
  ]);

  for (const guide of [caseBrief, evaluation, submission]) {
    assert.match(guide, /evals/iu);
    assert.match(guide, /client presentation/iu);
    assert.match(guide, /live operator design check/iu);
    assert.match(guide, /same submitted commit|exact submitted commit/iu);
  }

  assert.match(evaluation, /reviewer acts as a People Operations operator/iu);
  assert.match(evaluation, /first-use pass is unaided/iu);
  assert.match(submission, /reviewer controls the mouse and keyboard/iu);
  assert.match(submission, /observe without telling the reviewer where to click/iu);
});

test("discovery record preserves admission access uncertainty and complete source coverage", async () => {
  const discovery = JSON.parse(await readFile(new URL("../case-data/client-discovery/discovery-sessions.json", import.meta.url), "utf8")) as {
    provenanceEnvelope?: {
      reviewedArtifacts?: Record<string, number>;
      consolidationNote?: string;
    };
    sessions?: Array<{
      sessionId?: string;
      observations?: Array<{ text?: string }>;
    }>;
  };

  assert.deepEqual(discovery.provenanceEnvelope?.reviewedArtifacts, {
    callArtifacts: 15,
    emailArtifacts: 13,
    collaborationSummaries: 2,
    memoryRecords: 1,
    localProjectFiles: 27,
  });
  assert.match(discovery.provenanceEnvelope?.consolidationNote ?? "", /memory record is counted separately from the 15 call artifacts/iu);

  const sourceFollowUp = discovery.sessions
    ?.find((session) => session.sessionId === "discovery-09")
    ?.observations?.map((observation) => observation.text ?? "")
    .join(" ") ?? "";
  assert.match(sourceFollowUp, /anonymized admission cases were reported as uploaded/iu);
  assert.match(sourceFollowUp, /did not establish access, validation, or agreed expected outcomes/iu);
  assert.doesNotMatch(sourceFollowUp, /no validated end-to-end admission cases or expected outcomes were supplied/iu);
});

test("submission guide stops the clock when invitation logistics are incomplete", async () => {
  const guide = await readFile(new URL("../SUBMISSION.md", import.meta.url), "utf8");

  assert.match(guide, /deadline date and time/iu);
  assert.match(guide, /deadline timezone/iu);
  assert.match(guide, /private channel or thread for submission/iu);
  assert.match(guide, /reviewer identity and repository account/iu);
  assert.match(guide, /reply to the original sender before starting/iu);
  assert.match(guide, /16-hour clock has not started/iu);
  assert.match(guide, /no submission is valid until all four details are confirmed/iu);
});

test("candidate image owns durable state as the prescribed runtime identity", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(dockerfile, /chown 65532:65532 \/state/iu);
  assert.match(dockerfile, /^USER 65532:65532$/mu);
  assert.doesNotMatch(dockerfile, /^USER node$/mu);
});
