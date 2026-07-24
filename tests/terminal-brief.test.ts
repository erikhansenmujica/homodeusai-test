import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderWorkbench } from "../src/ui.ts";

test("terminal boots with only the four-line case statement and command prompt", () => {
  const html = renderWorkbench();
  const bootSection = html.match(/<section class="boot-copy"[\s\S]*?<\/section>/u)?.[0] ?? "";
  const bootLines = [...bootSection.matchAll(/data-boot-text="([^"]+)"/gu)].map((match) => match[1]);

  assert.deepEqual(bootLines, [
    "GROUNDING GAUNTLET // Nexo Atlântico knowledge case",
    "34 governed sources. one decision surface.",
    "answer when the record supports it.",
    "if it does not, leave a human handoff someone can work.",
  ]);
  assert.match(html, /placeholder="Question or command"/u);
  assert.doesNotMatch(bootSection, /type help|awaiting question|profile|context --edit|conversation --json/iu);
});

test("terminal command tree contains the complete candidate briefing", () => {
  const html = renderWorkbench();
  for (const command of ["problem", "evidence", "workflow", "data", "mandate", "constraints", "evals", "deliver", "contract", "docs", "setup", "download"]) {
    assert.match(html, new RegExp(`"${command}"`, "u"), `missing terminal command: ${command}`);
  }

  assert.match(html, /another chatbot would duplicate it and leave the operating pain intact/iu);
  assert.match(html, /15 call artifacts \/ 13 email artifacts \/ 2 channel summaries/iu);
  assert.match(html, /1 separate memory record \/ 27 files/iu);
  assert.match(html, /RAG decision service and finished, deliberate browser UI/iu);
  assert.match(html, /durable owned case with context and completion/iu);
  assert.match(html, /existing internal assistant/iu);
  assert.match(html, /no labeled end-to-end validation set/iu);
  assert.match(html, /pilot scope boundary/iu);
  assert.match(html, /one expand condition and one stop condition/iu);
  assert.match(html, /candidate-kit\.tgz\.sha256/iu);
  assert.match(html, /CANDIDATE_BASE_URL=http:\/\/127\.0\.0\.1:8080 npm run evals/u);
  assert.match(html, /FINAL REVIEW \/\/ SAME COMMIT/iu);
  assert.match(html, /1 \/ EVALS/iu);
  assert.match(html, /2 \/ CLIENT PRESENTATION/iu);
  assert.match(html, /3 \/ LIVE OPERATOR DESIGN CHECK/iu);
  assert.match(html, /reviewer acts as the People Operations operator and controls the product/iu);
  assert.match(html, /candidate observes the unaided first-use pass instead of driving/iu);
  assert.match(html, /clear, coherent, beautiful, responsive, and operable without narration/iu);
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

test("deliver command exposes complete private submission logistics", () => {
  const html = renderWorkbench();

  assert.match(html, /invitation must name all four before you start/iu);
  assert.match(html, /command: "deadline", description: "date \+ time"/iu);
  assert.match(html, /command: "timezone", description: "deadline timezone"/iu);
  assert.match(html, /private submission channel or thread/iu);
  assert.match(html, /command: "reviewer", description: "identity \+ repository account"/iu);
  assert.match(html, /private repository URL \+ exact commit SHA/iu);
  assert.match(html, /reply to the original sender before starting/iu);
  assert.match(html, /16-hour clock has not started/iu);
  assert.match(html, /no submission is valid until all four are confirmed/iu);
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
