import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderWorkbench } from "../src/ui.ts";

const clientUrl = new URL("../src/public/workbench.js", import.meta.url);
const sessionUrl = new URL("../src/public/workbench/session.js", import.meta.url);
const styleUrl = new URL("../src/public/workbench.css", import.meta.url);

test("answer evidence uses stable source routes and byte-exact highlighting", async () => {
  const client = await readFile(clientUrl, "utf8");
  assert.match(client, /data-testid", "claims-panel"/u);
  assert.match(client, /data-testid", testId/u);
  assert.match(client, /makeSourceAnchor\(metadata, "Abrir document/u);
  assert.match(client, /new TextEncoder\(\)/u);
  assert.match(client, /bytes\.slice\(span\.startByte, span\.endByte\)/u);
  assert.match(client, /mark\.id = "evidence-highlight"/u);
  assert.match(client, /window\.history\.pushState/u);
  assert.match(client, /window\.addEventListener\("popstate"/u);
});

test("defer recommendations are derived from trace and corpus metadata", async () => {
  const client = await readFile(clientUrl, "utf8");
  assert.match(client, /reason === "conflicting_source"/u);
  assert.match(client, /trace\.conflicts/u);
  assert.match(client, /reason === "validation_pending"/u);
  assert.match(client, /reason === "profile_mismatch"/u);
  assert.match(client, /filteredCorpusHref\("domain", related\.domain\)/u);
  assert.match(client, /Nenhum documento específico é presumido como existente/u);
  assert.match(client, /Ver metadados governados/u);
});

test("follow-ups send bounded visible history while requester remains registry-derived", async () => {
  const client = await readFile(clientUrl, "utf8");
  assert.match(client, /\.slice\(-3\)/u);
  assert.match(client, /visibleAssistantText\(entry\.decision\)/u);
  assert.match(client, /history: history/u);
  assert.match(client, /requester: requesterFor\(profile\)/u);
  assert.match(client, /subjectId: "trusted-session-" \+ profile\.profileId/u);
  assert.doesNotMatch(client, /requester:\s*history/u);
});

test("trusted context changes separate conversation state and session history restores only bounded identifiers", async () => {
  const [client, session] = await Promise.all([
    readFile(clientUrl, "utf8"),
    readFile(sessionUrl, "utf8"),
  ]);
  assert.match(client, /function changeTrustedContext\(\)/u);
  assert.match(client, /Uma nova linha de decisão foi iniciada/u);
  assert.match(client, /currentThreadId = makeId\("thread"\)/u);
  assert.match(session, /window\.sessionStorage\.setItem/u);
  assert.match(session, /handoffOpen:/u);
  assert.match(session, /selectedSource:/u);
  assert.match(session, /trace: null/u);
  assert.match(session, /handoffRecord: null/u);
  assert.doesNotMatch(session, /trace: entry\.trace/u);
  assert.doesNotMatch(session, /handoffRecord: entry\.handoffRecord/u);
  assert.match(client, /renderHistory\(\);[\s\S]{0,200}Caso resolvido e histórico atualizado/u);
});

test("loading, slow, typed defer, transport failure, and keyboard states remain distinct", async () => {
  const [html, client] = [renderWorkbench(), await readFile(clientUrl, "utf8")];
  assert.match(html, /data-testid="submit-decision"[\s\S]*aria-busy="false"/u);
  assert.match(client, /submit\.setAttribute\("aria-busy", isBusy \? "true" : "false"\)/u);
  assert.match(client, /4500\)/u);
  assert.match(client, /decision\.kind === "defer"/u);
  assert.match(client, /makeFailureDecision/u);
  assert.match(html, /data-testid="error-state"/u);
  assert.match(client, /event\.key === "Enter" && !event\.shiftKey/u);
  assert.match(client, /form\.requestSubmit\(\)/u);
});

test("completed decisions announce their result without forcing a viewport jump", async () => {
  const client = await readFile(clientUrl, "utf8");
  assert.match(client, /Nova resposta sustentada disponível/u);
  assert.equal(
    client.match(/byId\("decision-result"\)\.scrollIntoView/gu)?.length ?? 0,
    0,
    "result rendering and history restoration must not scroll the decision timeline",
  );
  assert.match(client, /function preserveViewport/u);
});

test("responsive source drawer prevents overflow and manages keyboard focus", async () => {
  const [client, styles] = await Promise.all([
    readFile(clientUrl, "utf8"),
    readFile(styleUrl, "utf8"),
  ]);
  assert.match(styles, /overflow-x: clip/u);
  assert.match(styles, /@media \(max-width: 760px\)/u);
  assert.match(styles, /\.source-rail \{[\s\S]*width: 100vw/u);
  assert.match(styles, /\.source-backdrop \{[\s\S]*display: none/u);
  assert.match(styles, /@media \(max-width: 1120px\) \{[\s\S]*\.source-backdrop \{[\s\S]*display: block/u);
  assert.match(styles, /white-space: pre-wrap/u);
  assert.match(client, /byId\("source-backdrop"\)\.hidden = !drawerMode/u);
  assert.match(client, /window\.history\.replaceState\(\{ sourceOverlay: false \}, "", sourceBackHref\(\)\)/u);
  assert.doesNotMatch(client, /window\.history\.back\(\)/u);
  assert.doesNotMatch(client, /window\.location\.assign\("\/"\)/u);
  assert.match(client, /function trapSourceFocus/u);
  assert.match(client, /event\.key === "Escape"/u);
  assert.match(client, /sourceReturnFocus\.focus\(\)/u);
});

test("restricted source content is not logged, embedded, or persisted in client state", async () => {
  const [html, client] = [renderWorkbench(), await readFile(clientUrl, "utf8")];
  assert.doesNotMatch(html, /DOCUMENTO SINTÉTICO/u);
  assert.doesNotMatch(client, /console\.(?:log|debug|info|warn|error)/u);
  assert.doesNotMatch(client, /\.innerHTML\s*=/u);
  assert.doesNotMatch(client, /content: payload\.content/u);
  assert.match(client, /payload\.access === "available" && typeof payload\.content === "string"/u);
});
