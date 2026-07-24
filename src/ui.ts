/**
 * Candidate starter terminal.
 *
 * It is intentionally marked incomplete. The assessment requires candidates
 * to own the final operator experience, remove the starter marker, and satisfy
 * the browser contract documented in CASE.md and CONTRACT.md.
 */
export function renderWorkbench(): string {
  return `<!doctype html>
<html lang="en">
<head data-public-surface="candidate">
  <meta charset="utf-8" data-testid="document-encoding">
  <meta name="viewport" data-testid="viewport-policy" content="width=device&#45;width, initial-scale=1">
  <meta name="gauntlet-starter" content="incomplete">
  <link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjMDgwYTBiIi8+PHBhdGggZD0iTTQgNGw0IDQtNCA0TTkgMTJoMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjhiOGFiIiBzdHJva2Utd2lkdGg9IjEuNSIvPjwvc3ZnPg==">
  <title>GROUNDING GAUNTLET | client decision case</title>
  <style>
    :root {
      color-scheme: dark;
      --void: #080a0b;
      --inset: #0d0f11;
      --line: #202429;
      --line-strong: #59616c;
      --faint: #707987;
      --dim: #969eab;
      --text: #cdd2da;
      --bright: #edf0f2;
      --amber: #e08a1e;
      --amber-strong: #eda143;
      --teal: #68b8ab;
      --error: #df9b65;
      --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
      --layout-row: flex;
      --cross-center: center;
      --spread: space-between;
      --row-end: flex-end;
      --command-layout: grid;
      --command-columns: 12ch minmax(0, 1fr);
      --claim-weight: 500;
      --control-rule: 1px solid var(--line-strong);
      --table-rule: 1px solid var(--line);
      --sticky-table-top: 0;
      --skip-focus-ring: 0 0 0 3px var(--void);
    }

    * { box-sizing: border-box; }
    html { min-width: 320px; background: var(--void); }
    body {
      min-width: 320px;
      min-height: 100dvh;
      margin: 0;
      background: var(--void);
      color: var(--text);
      font: 13.5px/1.62 var(--mono);
      font-variant-ligatures: none;
      -webkit-font-smoothing: antialiased;
    }
    button, input, select, textarea { font: inherit; }
    button, input, select, textarea, summary { outline: 0; }
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    summary:focus-visible,
    [tabindex="0"]:focus-visible {
      outline: 2px solid var(--amber);
      outline-offset: 3px;
    }
    #question:focus-visible { outline: 0; }
    [hidden] { display: none !important; }
    ::selection { background: var(--amber); color: var(--void); }

    .sr-only {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }
    .skip-link {
      position: fixed;
      top: 8px;
      left: 8px;
      z-index: 10;
      padding: 7px 9px;
      border: 1px solid var(--amber);
      background: var(--void);
      color: var(--amber-strong);
      text-decoration: none;
      box-shadow: var(--skip-focus-ring);
      transform: translateY(-160%);
    }
    .skip-link:focus {
      outline: none;
      transform: none;
    }

    .topline {
      position: fixed;
      inset: 0 0 auto;
      z-index: 3;
      min-height: 42px;
      padding: 12px 26px;
      display: var(--layout-row);
      align-items: var(--cross-center);
      justify-content: var(--spread);
      gap: 20px;
      background: var(--void);
      color: var(--faint);
      font-size: 11px;
      letter-spacing: .075em;
    }
    .topline-name { text-transform: lowercase; white-space: nowrap; }
    .service-state {
      min-width: 0;
      display: var(--layout-row);
      align-items: var(--cross-center);
      justify-content: var(--row-end);
      gap: 13px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .service-state [data-state="ok"] { color: var(--teal); }
    .service-state [data-state="error"] { color: var(--error); }

    .term-screen {
      width: min(980px, 100%);
      margin: 0 auto;
      padding: 64px 26px 56px;
      overflow-x: clip;
    }
    .terminal-session { min-height: calc(100dvh - 40px); }
    .tline {
      min-height: 1.62em;
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .boot-line { visibility: hidden; }
    .boot-line.is-visible {
      visibility: visible;
      animation: boot-line-in 240ms cubic-bezier(.22, .7, .2, 1) both;
    }
    body.boot-instant .boot-line.is-visible { animation: none; }
    .type-caret {
      display: none;
      width: .5ch;
      height: 1.02em;
      margin-left: 1px;
      vertical-align: -2px;
      background: var(--amber);
      animation: caret-blink 1.05s step-end infinite;
    }
    .boot-line.is-typing .type-caret { display: inline-block; }
    body[data-boot-state="pending"] .terminal-operational,
    body[data-boot-state="running"] .terminal-operational {
      opacity: 0;
      pointer-events: none;
    }
    @keyframes boot-line-in {
      from { opacity: 0; transform: translateY(3px); }
      to { opacity: 1; transform: none; }
    }
    @keyframes caret-blink {
      0%, 55% { opacity: 1; }
      56%, 100% { opacity: 0; }
    }
    .line-gap { height: 1.62em; }
    #runtime-fallback { margin-top: 1.62em; }
    .glyph { display: inline-block; width: 2ch; color: var(--faint); user-select: none; }
    .shell { color: var(--teal); }
    .amber { color: var(--amber); }
    .bright { color: var(--bright); }
    .dim { color: var(--dim); }
    .faint { color: var(--faint); }
    .error { color: var(--error); }

    .command-feedback:empty { display: none; }
    .command-feedback { margin: 1.62em 0 0; }
    .command-feedback .tline { padding-left: 2ch; text-indent: -2ch; }
    .command-feedback .command-row {
      display: var(--command-layout);
      grid-template-columns: var(--command-columns);
      gap: 1ch;
      padding-left: 2ch;
      text-indent: 0;
    }
    .command-name { color: var(--bright); }
    .command-feedback a { color: var(--amber); text-decoration-thickness: 1px; text-underline-offset: .18em; }
    .command-feedback a:hover { color: var(--text); }
    .command-feedback .section-label { margin-top: 1.62em; color: var(--amber); }

    .decision-stream { margin-top: 1.62em; }
    .decision-shell { max-width: 84ch; }
    .decision-topline {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 20px;
    }
    .decision-kind { color: var(--amber); font-weight: 700; }
    .decision-kind[data-kind="defer"] { color: var(--error); }
    .decision-kind[data-kind="conversational"] { color: var(--teal); }
    .response-metrics {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 14px;
      color: var(--faint);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .decision-message {
      max-width: 78ch;
      margin: .55em 0 0 2ch;
      color: var(--bright);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .subhead {
      margin: 1.62em 0 .35em 2ch;
      color: var(--dim);
      font-size: inherit;
      font-weight: 500;
    }
    .claims { margin-left: 2ch; }
    .claim-card { margin-top: .8em; }
    .claim-head { display: flex; align-items: baseline; gap: 1ch; }
    .claim-id { color: var(--amber); font-weight: 700; white-space: nowrap; }
    .claim-text { color: var(--text); font-weight: var(--claim-weight); }
    .evidence { margin: .45em 0 0 2ch; }
    .evidence-meta { color: var(--faint); font-size: 11px; overflow-wrap: anywhere; }
    .evidence blockquote {
      margin: .25em 0 0;
      padding-left: 2ch;
      color: var(--text);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .handoff-grid { margin: .35em 0 0 2ch; }
    .handoff-grid div {
      display: grid;
      grid-template-columns: 15ch minmax(0, 1fr);
      gap: 1ch;
    }
    .handoff-grid dt { color: var(--faint); }
    .handoff-grid dd { min-width: 0; margin: 0; color: var(--text); overflow-wrap: anywhere; }

    .response-actions {
      margin: 1.1em 0 0 2ch;
      display: var(--layout-row);
      align-items: var(--cross-center);
      gap: 2ch;
    }
    .terminal-button {
      min-height: 30px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--teal);
      cursor: pointer;
      text-align: left;
    }
    .terminal-button::before { content: "["; color: var(--faint); }
    .terminal-button::after { content: "]"; color: var(--faint); }
    .terminal-button:disabled { color: var(--faint); cursor: not-allowed; opacity: .65; }

    .payload-details, .trace-details { margin: .8em 0 0 2ch; }
    .payload-details summary, .trace-details summary {
      width: fit-content;
      min-height: 30px;
      display: flex;
      align-items: center;
      color: var(--dim);
      cursor: pointer;
    }
    details summary::marker { color: var(--amber); }
    details[open] > summary { color: var(--text); }
    pre {
      max-width: 86ch;
      margin: .3em 0 0 2ch;
      padding: 0;
      overflow: auto;
      background: transparent;
      color: var(--dim);
      font: 11px/1.55 var(--mono);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 2;
    }

    .terminal-prompt { margin-top: 1.62em; }
    .ask-line {
      display: flex;
      align-items: flex-start;
      gap: 1ch;
      min-width: 0;
    }
    .prompt-glyph {
      width: 1ch;
      flex: 0 0 1ch;
      padding-top: 1px;
      color: var(--teal);
      user-select: none;
    }
    .ask-line:focus-within .prompt-glyph { color: var(--amber-strong); }
    input, select, textarea {
      min-width: 0;
      border: 0;
      border-bottom: var(--control-rule);
      border-radius: 0;
      background: transparent;
      color: var(--bright);
      caret-color: var(--amber);
    }
    input::placeholder, textarea::placeholder { color: var(--faint); opacity: 1; }
    select { width: min(360px, 65vw); min-height: 32px; padding: 2px 22px 2px 2px; }
    input { min-height: 32px; padding: 2px 4px; }
    textarea {
      width: 100%;
      min-height: 38px;
      max-height: 9.7em;
      padding: 6px 4px 4px;
      resize: vertical;
      line-height: 1.5;
    }
    #question {
      min-height: 1.62em;
      max-height: 8.1em;
      padding: 0;
      border-bottom: 0;
      resize: none;
      overflow-y: hidden;
      line-height: 1.62;
      scroll-margin-block-start: 56px;
      scroll-margin-block-end: 16px;
    }
    .form-error {
      min-height: 1.62em;
      margin: .25em 0 0 2ch;
      color: var(--error);
      overflow-wrap: anywhere;
    }
    .form-error:empty { min-height: 0; margin-top: 0; }

    .source-stream {
      min-width: 0;
      padding-top: 42px;
      scroll-margin-top: 56px;
    }
    .source-command { color: var(--bright); }
    .inventory-tools {
      margin: .75em 0 .9em 2ch;
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }
    #source-search { width: min(360px, 100%); }
    #approval-filter { width: 180px; }
    .table-wrap {
      width: 100%;
      max-width: 100%;
      max-height: min(68vh, 640px);
      overflow: auto;
      overscroll-behavior-inline: contain;
      scrollbar-gutter: stable;
    }
    table {
      width: 100%;
      min-width: 1320px;
      table-layout: fixed;
      border-collapse: collapse;
      color: var(--dim);
      font-size: 11px;
    }
    th, td {
      padding: 7px 9px;
      border-bottom: var(--table-rule);
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      position: sticky;
      top: var(--sticky-table-top);
      z-index: 1;
      background: var(--void);
      color: var(--faint);
      font-weight: 500;
      white-space: nowrap;
    }
    td.mono { font-variant-numeric: tabular-nums; }
    th:nth-child(1) { width: 165px; }
    th:nth-child(2) { width: 185px; }
    th:nth-child(3) { width: 112px; }
    th:nth-child(4) { width: 100px; }
    th:nth-child(5) { width: 95px; }
    th:nth-child(6) { width: 105px; }
    th:nth-child(7) { width: 90px; }
    th:nth-child(8) { width: 105px; }
    th:nth-child(9) { width: 154px; }
    th:nth-child(10) { width: 156px; }
    th:nth-child(11) { width: 78px; }
    .table-state td { height: 90px; color: var(--faint); vertical-align: middle; }
    .inventory-foot {
      min-height: 32px;
      display: var(--layout-row);
      align-items: var(--cross-center);
      justify-content: var(--spread);
      gap: 16px;
      color: var(--faint);
      font-size: 11px;
    }

    @media (hover: hover) and (pointer: fine) {
      .terminal-button:hover { color: var(--amber-strong); }
      input:hover, select:hover, textarea:hover { border-bottom-color: var(--dim); }
      tbody tr:hover { color: var(--text); }
    }
    @media (max-width: 640px) {
      .topline { min-height: 40px; padding: 10px 16px; font-size: 10px; }
      .topline-suffix { display: none; }
      .service-state { gap: 8px; }
      .service-state #ready-state:not([data-state]) { display: none; }
      .term-screen { padding: 56px 16px 34px; }
      .terminal-session { min-height: calc(100dvh - 28px); }
      .decision-topline { align-items: flex-start; flex-direction: column; gap: 3px; }
      .response-metrics { justify-content: flex-start; }
      select { width: 100%; min-height: 44px; }
      .ask-line .prompt-glyph { padding-top: 11px; }
      #question { min-height: 44px; padding: 10px 0; }
      input, button, details summary { min-height: 44px; }
      .response-actions { margin-left: 0; }
      .payload-details, .trace-details { margin-left: 0; }
      .inventory-tools { align-items: stretch; flex-direction: column; margin-left: 2ch; }
      #source-search, #approval-filter { width: calc(100% - 2ch); min-height: 44px; }
      .inventory-tools .terminal-button { min-height: 44px; }
      .table-wrap { border-top: var(--table-rule); }
      th:first-child, td:first-child {
        position: sticky;
        left: 0;
        z-index: 2;
        background: var(--void);
      }
    }
    @media (max-width: 360px) {
      .service-state #health-state { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        animation: none !important;
        transition: none !important;
      }
      .boot-line { visibility: visible !important; }
      .boot-text:empty::after { content: attr(data-boot-text); }
      .type-caret { display: none !important; }
      body[data-boot-state] .terminal-operational {
        opacity: 1;
        pointer-events: auto;
      }
    }
  </style>
</head>
<body data-starter="incomplete" data-boot-state="pending">
  <noscript>
    <style>
      .boot-line { visibility: visible; }
      .boot-text:empty::after { content: attr(data-boot-text); }
      #decision-form, #source-inventory, .service-state, .skip-link { display: none !important; }
      #runtime-fallback { display: block !important; }
    </style>
  </noscript>
  <a class="skip-link" href="#question">Skip to question</a>
  <header class="topline">
    <span class="topline-name">grounding gauntlet<span class="topline-suffix"> / client decision case</span></span>
    <span class="service-state" aria-label="Service status">
      <span id="health-state">health checking</span>
      <span id="ready-state">ready checking</span>
    </span>
  </header>

  <main id="term-screen" class="term-screen" data-testid="decision-workbench">
    <section class="terminal-session" aria-labelledby="terminal-title">
      <h1 id="terminal-title" class="sr-only">Grounding Gauntlet candidate terminal</h1>

      <p class="sr-only">Grounding Gauntlet. Nexo Atlântico knowledge case. 34 governed sources, one decision surface. Answer when the record supports it. If it does not, leave a human handoff someone can work.</p>
      <section class="boot-copy" data-testid="boot-terminal" aria-hidden="true">
        <p class="tline boot-line" data-boot-line data-speed="20"><span class="glyph">&gt;</span><span class="boot-text bright" data-boot-text="GROUNDING GAUNTLET // Nexo Atlântico knowledge case"></span><span class="type-caret"></span></p>
        <p class="tline boot-line" data-boot-line data-speed="13"><span class="glyph">&gt;</span><span class="boot-text" data-boot-text="34 governed sources. one decision surface."></span><span class="type-caret"></span></p>
        <div class="line-gap" aria-hidden="true"></div>
        <p class="tline boot-line" data-boot-line data-speed="13"><span class="glyph">&gt;</span><span class="boot-text" data-boot-text="answer when the record supports it."></span><span class="type-caret"></span></p>
        <p class="tline boot-line" data-boot-line data-speed="11"><span class="glyph">&gt;</span><span class="boot-text" data-boot-text="if it does not, leave a human handoff someone can work."></span><span class="type-caret"></span></p>
      </section>

      <p id="runtime-fallback" class="tline error" hidden><span class="glyph shell">$</span>JavaScript is required to run a decision.</p>

      <section id="command-feedback" class="command-feedback terminal-operational" data-boot-aria aria-hidden="true" role="log" aria-live="polite" aria-relevant="additions" aria-atomic="false" aria-label="Command output"></section>

      <section class="decision-stream terminal-operational" data-boot-aria aria-hidden="true" data-testid="decision-result" aria-label="Decision output">
        <article id="decision-shell" class="decision-shell" hidden>
          <div class="decision-topline">
            <span id="decision-kind" class="decision-kind" data-kind="defer">unknown</span>
            <div class="response-metrics">
              <span id="decision-score">score n/a</span>
              <span id="decision-latency">0 ms</span>
              <span id="decision-trace">trace n/a</span>
            </div>
          </div>
          <p id="decision-message" class="decision-message"></p>

          <section id="claims-section" hidden data-testid="claims-panel">
            <h2 class="subhead">claims / exact evidence</h2>
            <div id="claims" class="claims"></div>
          </section>

          <section id="handoff-section" hidden data-testid="handoff-panel">
            <h2 class="subhead">human handoff</h2>
            <dl id="handoff" class="handoff-grid"></dl>
          </section>
        </article>

        <div id="response-actions" class="response-actions" hidden>
          <button id="load-trace" class="terminal-button" type="button" data-testid="trace-trigger" aria-controls="trace-details" aria-expanded="false" disabled>trace</button>
          <button id="copy-response" class="terminal-button" type="button" disabled>copy payload</button>
        </div>
        <details id="payload-details" class="payload-details" hidden>
          <summary>raw decision payload</summary>
          <pre id="response-json"></pre>
        </details>
        <details id="trace-details" class="trace-details" data-testid="trace-panel" hidden>
          <summary>diagnostic trace</summary>
          <pre id="trace-json"></pre>
        </details>
      </section>

      <div id="decision-announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>

      <form id="decision-form" class="terminal-prompt terminal-operational" data-boot-aria aria-hidden="true" data-testid="request-form">
        <div class="ask-line">
          <span class="prompt-glyph" aria-hidden="true">$</span>
          <label class="sr-only" for="question">Question or command</label>
          <textarea id="question" data-testid="question-input" aria-keyshortcuts="Enter Meta+Enter Control+Enter" required lang="pt-BR" rows="1" autocomplete="off" placeholder="Question or command"></textarea>
          <button id="run-decision" class="sr-only" data-testid="submit-decision" type="submit" tabindex="-1">Run question</button>
        </div>
        <div id="form-error" class="form-error" role="alert" data-testid="error-state"></div>
      </form>
    </section>

    <section id="source-inventory" class="source-stream" aria-labelledby="inventory-title" data-testid="source-inventory">
      <h2 id="inventory-title" class="tline source-command"><span class="glyph shell">$</span>sources --all</h2>
      <div class="inventory-tools">
        <input id="source-search" type="search" aria-label="Filter sources" placeholder="filter source, title, domain" autocomplete="off">
        <select id="approval-filter" aria-label="Filter approval state">
          <option value="">all approval states</option>
          <option value="approved">approved</option>
          <option value="pending">pending</option>
          <option value="rejected">rejected</option>
        </select>
        <button id="refresh-sources" class="terminal-button" type="button">refresh</button>
      </div>
      <div class="table-wrap" role="region" tabindex="0" aria-labelledby="inventory-title">
        <table>
          <caption class="sr-only">Governed source metadata</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Title</th>
              <th scope="col">Domain</th>
              <th scope="col">Type</th>
              <th scope="col">Format</th>
              <th scope="col">Extraction</th>
              <th scope="col">Approval</th>
              <th scope="col">Sensitivity</th>
              <th scope="col">Effective</th>
              <th scope="col">Eligibility</th>
              <th scope="col">Bytes</th>
            </tr>
          </thead>
          <tbody id="source-rows"></tbody>
        </table>
      </div>
      <div class="inventory-foot" data-testid="inventory-status"><span id="inventory-state">metadata endpoint</span><span id="inventory-count">0 sources</span></div>
    </section>
  </main>

  <script>
    window.__gauntletBootFallback = window.setTimeout(function () {
      if (document.body.dataset.bootState === "complete") return;
      document.body.classList.add("boot-instant");
      document.querySelectorAll("[data-boot-text]").forEach(function (text) {
        text.textContent = text.getAttribute("data-boot-text") || "";
        text.closest("[data-boot-line]").classList.add("is-visible");
        text.closest("[data-boot-line]").classList.remove("is-typing");
      });
      document.querySelectorAll("[data-boot-aria]").forEach(function (element) {
        element.removeAttribute("aria-hidden");
      });
      if (window.__gauntletRuntimeReady !== true) {
        document.getElementById("decision-form").hidden = true;
        document.getElementById("source-inventory").hidden = true;
        document.getElementById("runtime-fallback").hidden = false;
        document.querySelector(".service-state").hidden = true;
        document.querySelector(".skip-link").hidden = true;
      }
      document.body.dataset.bootState = "complete";
    }, 4500);
  </script>
  <script>
    (function () {
      "use strict";

      var documents = [];
      var profiles = [];
      var activeProfile = null;
      var profileLoadError = "";
      var logicalRequestIds = new Map();
      var responsePayload = null;
      var traceId = "";
      var inFlight = false;
      var activeController = null;
      var activeTraceController = null;
      var cancelReason = "";
      var commandHistory = [];
      var historyIndex = -1;

      var COMMANDS = [
        "help", "commands", "start", "problem", "brief", "evidence", "client", "discovery",
        "workflow", "data", "dataset", "mandate", "build", "frontend", "constraints", "rules",
        "contract", "evals", "evaluation", "deliver", "present", "submission", "docs", "setup",
        "sources", "corpus", "download", "ask", "clear"
      ];
      var COMMAND_ALIASES = {
        commands: "help",
        brief: "problem",
        client: "evidence",
        discovery: "evidence",
        dataset: "data",
        build: "mandate",
        frontend: "mandate",
        rules: "constraints",
        evaluation: "evals",
        present: "deliver",
        submission: "deliver",
        corpus: "sources"
      };
      var byId = function (id) { return document.getElementById(id); };
      var form = byId("decision-form");
      var runButton = byId("run-decision");
      var formError = byId("form-error");
      var questionInput = byId("question");
      var sourceSearch = byId("source-search");
      var approvalFilter = byId("approval-filter");
      var sourceRows = byId("source-rows");
      var inventoryCount = byId("inventory-count");
      var copyButton = byId("copy-response");
      var traceButton = byId("load-trace");
      var commandFeedback = byId("command-feedback");
      var decisionAnnouncer = byId("decision-announcer");
      var skipLink = document.querySelector(".skip-link");
      var bootLines = Array.from(document.querySelectorAll("[data-boot-line]"));
      var bootFinished = false;

      function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
      }

      function completeBoot(instant) {
        if (bootFinished) return;
        bootFinished = true;
        window.clearTimeout(window.__gauntletBootFallback);
        if (instant) document.body.classList.add("boot-instant");
        bootLines.forEach(function (line) {
          var text = line.querySelector("[data-boot-text]");
          if (text) text.textContent = text.getAttribute("data-boot-text") || "";
          line.classList.add("is-visible");
          line.classList.remove("is-typing");
        });
        document.body.dataset.bootState = "complete";
        document.querySelectorAll("[data-boot-aria]").forEach(function (element) {
          element.removeAttribute("aria-hidden");
        });
        document.removeEventListener("keydown", guardBootFocus, true);
        requestAnimationFrame(function () { questionInput.focus({ preventScroll: true }); });
      }

      function guardBootFocus(event) {
        if (document.body.dataset.bootState === "complete") {
          document.removeEventListener("keydown", guardBootFocus, true);
          return;
        }
        if (bootFinished || event.key !== "Tab") return;
        event.preventDefault();
        skipLink.focus({ preventScroll: true });
      }

      function typeBootLine(line) {
        var text = line.querySelector("[data-boot-text]");
        var chars = Array.from(text ? text.getAttribute("data-boot-text") || "" : "");
        var speed = Number(line.getAttribute("data-speed")) || 16;
        var perTick = chars.length > 56 ? 2 : 1;
        var index = 0;
        line.classList.add("is-visible", "is-typing");

        return new Promise(function (resolve) {
          function step() {
            if (bootFinished || document.body.dataset.bootState === "complete") {
              bootFinished = true;
              resolve();
              return;
            }
            for (var count = 0; count < perTick && index < chars.length; count += 1) {
              if (text) text.textContent += chars[index];
              index += 1;
            }
            if (index < chars.length) {
              setTimeout(step, speed);
              return;
            }
            line.classList.remove("is-typing");
            resolve();
          }
          step();
        });
      }

      async function runBootSequence() {
        if (bootFinished || document.body.dataset.bootState === "complete") {
          bootFinished = true;
          return;
        }
        document.body.dataset.bootState = "running";
        for (var index = 0; index < bootLines.length; index += 1) {
          await typeBootLine(bootLines[index]);
          if (bootFinished) return;
        }
        await sleep(180);
        completeBoot(false);
      }

      function scheduleBoot() {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          completeBoot(true);
          return;
        }
        var start = function () {
          requestAnimationFrame(function () {
            runBootSequence().catch(function () { completeBoot(true); });
          });
        };
        if (document.readyState === "complete") start();
        else window.addEventListener("load", start, { once: true });
      }

      function newId(prefix) {
        var value = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2);
        return prefix + "-" + value;
      }

      function showState(element, label, ok) {
        element.textContent = label + " " + (ok ? "ok" : "unavailable");
        element.dataset.state = ok ? "ok" : "error";
      }

      async function getJson(path, options) {
        var response = await fetch(path, options);
        var raw = await response.text();
        var parsed;
        try { parsed = raw ? JSON.parse(raw) : {}; }
        catch (_) { throw new Error("Non-JSON response from " + path); }
        if (!response.ok) throw new Error(String(parsed && parsed.error ? parsed.error : "HTTP " + response.status));
        return parsed;
      }

      async function checkService(path, element, label) {
        try { await getJson(path); showState(element, label, true); }
        catch (_) { showState(element, label, false); }
      }

      function feedback(lines, append) {
        if (!append) commandFeedback.replaceChildren();
        (Array.isArray(lines) ? lines : []).forEach(function (line) {
          var row = document.createElement("p");
          row.className = "tline" + (line && line.className ? " " + line.className : "");
          if (line && line.command) {
            row.classList.add("command-row");
            var commandName = document.createElement("span");
            commandName.className = "command-name";
            commandName.textContent = String(line.command);
            var description = document.createElement("span");
            description.textContent = String(line.description || "");
            row.append(commandName, description);
          } else if (line && line.href) {
            var link = document.createElement("a");
            link.href = String(line.href);
            link.textContent = line.text !== undefined ? String(line.text) : String(line.href);
            if (line.download) link.setAttribute("download", "");
            row.appendChild(link);
          } else {
            row.textContent = line && line.text !== undefined ? String(line.text) : String(line || "");
          }
          commandFeedback.appendChild(row);
        });
      }

      function rememberCommand(raw) {
        if (!raw || commandHistory[0] === raw) return;
        commandHistory.unshift(raw);
        if (commandHistory.length > 30) commandHistory.pop();
        historyIndex = -1;
      }

      function commandFrom(raw) {
        var trimmed = raw.trim();
        if (!trimmed) return null;
        var splitAt = trimmed.indexOf(" ");
        var name = (splitAt === -1 ? trimmed : trimmed.slice(0, splitAt)).toLowerCase();
        var args = splitAt === -1 ? "" : trimmed.slice(splitAt + 1).trim();
        if (!COMMANDS.includes(name)) return null;
        var canonical = COMMAND_ALIASES[name] || name;
        if (canonical === "sources") {
          return { name: canonical, args: !args || args === "--all" ? "" : args, raw: trimmed };
        }
        if (canonical === "ask") return { name: canonical, args: args, raw: trimmed };
        if (args) return null;
        return { name: canonical, args: "", raw: trimmed };
      }

      function runCommand(command) {
        rememberCommand(command.raw);
        formError.textContent = "";

        if (command.name === "help") {
          feedback([
            { text: "$ help", className: "dim" },
            { text: "READ THE ENGAGEMENT", className: "section-label" },
            { command: "start", description: "reading order" },
            { command: "problem", description: "client pain" },
            { command: "evidence", description: "record + tensions" },
            { command: "workflow", description: "operating flows" },
            { command: "data", description: "candidate data" },
            { command: "mandate", description: "work to ship" },
            { command: "constraints", description: "runtime + timebox" },
            { command: "evals", description: "proof contract" },
            { command: "deliver", description: "readout + handoff" },
            { text: "REFERENCE", className: "section-label" },
            { command: "contract", description: "locked interfaces" },
            { command: "docs", description: "file order" },
            { command: "setup", description: "run checks" },
            { command: "sources", description: "source inventory" },
            { command: "download", description: "candidate kit" },
            { command: "ask <text>", description: "run a question" },
            { command: "clear", description: "clear output" },
            { text: "" },
            { text: "tab completes commands. enter runs. ctrl+c cancels. ctrl+l clears.", className: "dim" }
          ], true);
          return true;
        }

        if (command.name === "start") {
          feedback([
            { text: "$ start", className: "dim" },
            { text: "problem -> evidence -> workflow -> data", className: "bright" },
            { text: "mandate -> constraints -> evals -> deliver", className: "bright" }
          ], true);
          return true;
        }

        if (command.name === "problem") {
          feedback([
            { text: "$ problem", className: "dim" },
            { text: "CLIENT", className: "section-label" },
            { text: "  People Operations answers employee questions and runs admission," },
            { text: "  payroll, time, leave, termination, safety, and data-change work." },
            { text: "CURRENT PAIN", className: "section-label" },
            { text: "  requests arrive across disconnected channels and systems." },
            { text: "  rules differ by entity, base, relationship, audience, and date." },
            { text: "  finding a plausible passage does not prove it can be used." },
            { text: "  unsupported answers create risk; generic transfers lose context." },
            { text: "  employees repeat themselves and deferred cases reopen." },
            { text: "COMPLICATION", className: "section-label" },
            { text: "  an internal email + FAQ assistant already handles part of the flow." },
            { text: "  another chatbot would duplicate it and leave the operating pain intact." },
            { text: "BUSINESS QUESTION", className: "section-label" },
            { text: "  can governed answers to employee questions cut manual work without" },
            { text: "  unsafe decisions, duplicated capability, or a new unowned queue?", className: "bright" },
            { text: "" },
            { text: "the build is fixed: RAG over the governed FAQ + policy corpus.", className: "amber" },
            { text: "it demos in a day. surviving production governance is the actual test.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "evidence") {
          feedback([
            { text: "$ evidence", className: "dim" },
            { text: "DISCOVERY COVERAGE", className: "section-label" },
            { text: "  15 call artifacts / 13 email artifacts / 2 channel summaries" },
            { text: "  1 separate memory record / 27 files" },
            { text: "  consolidated into 9 anonymized discovery moments." },
            { text: "WHAT THE RECORD ESTABLISHES", className: "section-label" },
            { text: "  analysts reconstruct work across many channels and specialist systems." },
            { text: "  senior staff answer from memory; junior staff search and copy." },
            { text: "  admission errors enter upstream, then create manual checks and chasing." },
            { text: "  the client asked for one working surface with evidence and audit." },
            { text: "  deployment, APIs, and sensitive data require parent-level approval." },
            { text: "  the existing internal assistant overlaps the original FAQ scope." },
            { text: "TENSIONS YOU MUST RESOLVE", className: "section-label" },
            { text: "  fewer touches vs zero unsupported answers" },
            { text: "  one operating surface vs unapproved or read-only integrations" },
            { text: "  learning from fallback vs governed knowledge change" },
            { text: "  broad sponsor story vs unvalidated interface, data, and scope" },
            { text: "" },
            { text: "read case-data/client-discovery/discovery-sessions.json for every observation." },
            { text: "paraphrases are business evidence, never employee-answer evidence.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "workflow") {
          feedback([
            { text: "$ workflow", className: "dim" },
            { text: "EMPLOYEE QUESTION / AS IS", className: "section-label" },
            { text: "  request enters one of several channels" },
            { text: "  -> analyst reconstructs requester context" },
            { text: "  -> searches policy, agreement, law, process, and prior knowledge" },
            { text: "  -> checks scope, authority, validity, sensitivity, and completeness" },
            { text: "  -> answers, transfers, or asks the employee to repeat context" },
            { text: "ADMISSION / AS IS", className: "section-label" },
            { text: "  upstream hiring request contains entity and contract fields" },
            { text: "  -> wrong fields bounce between teams" },
            { text: "  -> candidate enters data and uploads documents" },
            { text: "  -> analyst compares every field and file manually" },
            { text: "  -> registration is repeated in a restricted global system" },
            { text: "  -> medical, account, equipment, contract, and signature run in parallel" },
            { text: "  -> missing items are chased outside a durable case" },
            { text: "" },
            { text: "submission is not completion. a matching passage is not a decision.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "data") {
          var deliveries = new Set(documents.map(function (doc) { return doc.deliveryFileId; })).size;
          var faqSources = documents.filter(function (doc) { return doc.sourceType === "faq"; });
          var faqRows = faqSources.reduce(function (total, doc) { return total + (Number(doc.faqRows) || 0); }, 0);
          var formats = Array.from(new Set(documents.map(function (doc) { return doc.originalFormat; }).filter(Boolean))).sort().join(" / ");
          var ocr = documents.filter(function (doc) { return doc.ocrReviewed; }).length;
          feedback([
            { text: "$ data", className: "dim" },
            { text: "  deliveries        " + deliveries },
            { text: "  governed sources  " + documents.length },
            { text: "  faq sources       " + faqSources.length },
            { text: "  faq rows          " + faqRows },
            { text: "  formats           " + (formats || "not loaded") },
            { text: "  ocr reviewed      " + ocr },
            { text: "" },
            { text: "  content           case-data/source-documents.json" },
            { text: "  manifest          case-data/manifest.json" },
            { text: "  requester profiles case-data/actors/profiles.json" },
            { text: "  handoff policy     case-data/operations/human-handoff-policy.json" },
            { text: "  source files       case-data/sources/" },
            { text: "  session record     case-data/client-discovery/discovery-sessions.json" },
            { text: "  service baseline   case-data/client-discovery/service-baseline.json" },
            { text: "  stakeholder notes  case-data/client-discovery/stakeholder-notes.md" },
            { text: "  48 journeys        case-data/client-discovery/workflow-sample.csv" },
            { text: "  admission snapshot case-data/client-discovery/admission-case-snapshot.json" },
            { text: "  candidate evals    evals/cases.json", className: "dim" },
            { text: "" },
            { text: "discovery explains the business. source-documents alone may support answers.", className: "amber" },
            { text: "the admission record has no labeled end-to-end validation set.", className: "amber" },
            { text: "download complete candidate kit", href: "/candidate-kit.tgz", download: true }
          ], true);
          return true;
        }

        if (command.name === "mandate") {
          feedback([
            { text: "$ mandate", className: "dim" },
            { text: "1 / DIAGNOSE", className: "section-label" },
            { text: "  define the pain, affected users, failure cost, success measure," },
            { text: "  assumptions, contradictions, and first operating scope." },
            { text: "2 / BUILD", className: "section-label" },
            { text: "  ship one container with a RAG decision service and finished, deliberate browser UI." },
            { text: "  return answer / defer / conversational under the locked contract." },
            { text: "  make claims inspectable against exact eligible evidence." },
            { text: "  make deferral a durable owned case with context and completion." },
            { text: "3 / EVALUATE", className: "section-label" },
            { text: "  author and run a purposeful suite, report failures, change your design." },
            { text: "4 / PRESENT", className: "section-label" },
            { text: "  connect diagnosis, product, eval evidence, limitations, and rollout." },
            { text: "" },
            { text: "a search demo, unchanged starter, generic fallback, or defer-all system fails.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "constraints") {
          feedback([
            { text: "$ constraints", className: "dim" },
            { text: "ENGAGEMENT", className: "section-label" },
            { text: "  16 implementation hours / submission due 2 days after start" },
            { text: "  no promised write integrations or production access" },
            { text: "SECURITY", className: "section-label" },
            { text: "  no public network during evaluation" },
            { text: "  source and user text are untrusted" },
            { text: "  do not expose restricted text, secrets, or personal data in traces" },
            { text: "RUNTIME", className: "section-label" },
            { text: "  one build / one exact artifact / numeric user 65532:65532" },
            { text: "  read-only root / scratch /tmp / durable state at /state" },
            { text: "  2 vCPU / 4 GiB / 256 processes / warm concurrency 3" },
            { text: "  ready <=180s / p95 <=10s / p99 <=20s" },
            { text: "  provider may be slow, rate-limited, malformed, or absent" },
            { text: "  provider failure must still return a valid safe decision" },
            { text: "PACKAGE", className: "section-label" },
            { text: "  <=5000 files / <=7500 entries / <=100 MiB / <=20 MiB per file" },
            { text: "" },
            { text: "read CASE.md and SUBMISSION.md for every hard limit.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "contract") {
          feedback([
            { text: "$ contract", className: "dim" },
            { text: "  GET   /healthz" },
            { text: "  GET   /readyz" },
            { text: "  GET   /api/corpus" },
            { text: "  GET   /api/profiles" },
            { text: "  POST  /v1/decide" },
            { text: "  GET   /v1/traces/:traceId" },
            { text: "  GET   /v1/handoffs/:ticketId" },
            { text: "  POST  /v1/handoffs/:ticketId/resolve" },
            { text: "" },
            { text: "decision kinds: answer / defer / conversational" },
            { text: "answers: material claims + exact UTF-8 evidence spans" },
            { text: "defers: reason + durable idempotent ticket + owner + SLA + resolution path" },
            { text: "traces: ordered retrieval -> governance -> decision; exact eligible/rejected counts" },
            { text: "trace sources: every cited source/version; no protected content or raw requests" },
            { text: "read CONTRACT.md for the complete shapes and limits.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "download") {
          feedback([
            { text: "$ download", className: "dim" },
            { text: "download nexo-atlantico-knowledge-case.tgz", href: "/candidate-kit.tgz", download: true },
            { text: "download SHA-256 checksum", href: "/candidate-kit.tgz.sha256", download: true }
          ], true);
          return true;
        }

        if (command.name === "evals") {
          feedback([
            { text: "$ evals", className: "dim" },
            { text: "  author   12-48 non-sample cases in evals/cases.json" },
            { text: "  run      CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals" },
            { text: "  report   EVAL_REPORT.md" },
            { text: "" },
            { text: "REQUIRED SIGNAL", className: "section-label" },
            { text: "  supported + multi-source answers" },
            { text: "  missing, conflicting, stale, pending, restricted, or mismatched evidence" },
            { text: "  prompt/source injection and personal-data boundaries" },
            { text: "  paraphrases, repeated facts, and decision boundaries" },
            { text: "  same question with one profile or date axis changed" },
            { text: "  actionable deferrals and one risk from your own diagnosis" },
            { text: "" },
            { text: "include failures. explain thresholds. state what changed because of the run." },
            { text: "this is part 1 of the final review. sealed prompts, gold, and thresholds stay private.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "deliver") {
          feedback([
            { text: "$ deliver", className: "dim" },
            { text: "  product       source, Dockerfile, finished decision desk" },
            { text: "  client        CLIENT_READOUT.md" },
            { text: "  proof         evals/ + EVAL_REPORT.md" },
            { text: "  handoff       ARCHITECTURE.md + RUNBOOK.md" },
            { text: "  evidence      tests + desktop/mobile screenshots" },
            { text: "" },
            { text: "FINAL REVIEW // SAME COMMIT", className: "section-label" },
            { text: "  1 / EVALS" },
            { text: "      candidate suite + sealed system, browser, provider, and lifecycle checks" },
            { text: "  2 / CLIENT PRESENTATION" },
            { text: "      15-minute diagnosis, demo, eval learning, and recommendation" },
            { text: "  3 / LIVE OPERATOR DESIGN CHECK" },
            { text: "      reviewer acts as the People Operations operator and controls the product" },
            { text: "      candidate observes the unaided first-use pass instead of driving" },
            { text: "" },
            { text: "15-MINUTE CLIENT READOUT", className: "section-label" },
            { text: "  pain + evidence -> pilot scope boundary -> working demo" },
            { text: "  -> eval failure -> assistant ownership boundary -> recommendation" },
            { text: "  quantify the baseline; name the pilot owner and success measure" },
            { text: "  state one expand condition and one stop condition" },
            { text: "" },
            { text: "SUBMISSION LOGISTICS", className: "section-label" },
            { text: "  invitation must name all four before you start" },
            { command: "deadline", description: "date + time" },
            { command: "timezone", description: "deadline timezone" },
            { command: "channel", description: "private submission channel or thread" },
            { command: "reviewer", description: "identity + repository account" },
            { text: "" },
            { text: "  submit the private repository URL + exact commit SHA in that channel before the deadline" },
            { text: "  grant the reviewer account access; that SHA is evaluated" },
            { text: "  any detail missing? reply to the original sender before starting.", className: "amber" },
            { text: "  the 16-hour clock has not started; no submission is valid until all four are confirmed.", className: "amber" },
            { text: "" },
            { text: "demo one supported decision and one completed human handoff." },
            { text: "make the frontend clear, coherent, beautiful, responsive, and operable without narration." },
            { text: "run the clean build, checks, evidence, trace, lifecycle, and evals.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "docs") {
          feedback([
            { text: "$ docs", className: "dim" },
            { text: "  1  CASE.md                                  full business case" },
            { text: "  2  case-data/client-discovery/discovery-sessions.json" },
            { text: "  3  case-data/client-discovery/stakeholder-notes.md" },
            { text: "  4  case-data/client-discovery/service-baseline.json" },
            { text: "  5  case-data/client-discovery/workflow-sample.csv" },
            { text: "  6  case-data/client-discovery/admission-case-snapshot.json" },
            { text: "  7  CONTRACT.md                              locked interfaces" },
            { text: "  8  EVALUATION.md                            review + hard gates" },
            { text: "  9  SUBMISSION.md                            handoff + presentation" },
            { text: "  -  README.md                                entry point + data map" }
          ], true);
          return true;
        }

        if (command.name === "setup") {
          feedback([
            { text: "$ setup", className: "dim" },
            { text: "  runtime   Node 24" },
            { text: "  install   npm ci" },
            { text: "  develop   npm run dev" },
            { text: "  open      http://localhost:8080" },
            { text: "  types     npm run typecheck" },
            { text: "  tests     npm test" },
            { text: "  package   npm run self-check" },
            { text: "  evals     CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals" },
            { text: "  verify    GET /candidate-kit.tgz.sha256" },
            { text: "" },
            { text: "the starter eval run fails until you author a complete suite.", className: "amber" }
          ], true);
          return true;
        }

        if (command.name === "sources") {
          sourceSearch.value = command.args;
          renderSources();
          feedback([
            { text: "$ sources --all" + (command.args ? " --filter " + command.args : ""), className: "dim" },
            { text: inventoryCount.textContent + " rendered below" }
          ], true);
          requestAnimationFrame(function () { byId("source-inventory").scrollIntoView({ block: "start" }); });
          return true;
        }

        if (command.name === "clear") {
          commandFeedback.replaceChildren();
          return true;
        }

        return false;
      }

      function textCell(row, value, mono, title) {
        var cell = document.createElement("td");
        if (mono) cell.className = "mono";
        if (title) cell.title = title;
        cell.textContent = value === undefined || value === null || value === "" ? "none" : String(value);
        row.appendChild(cell);
      }

      function eligibilitySummary(value) {
        if (!value || typeof value !== "object") return "not specified";
        var parts = [
          ["entities", value.legalEntityIds],
          ["bases", value.baseIds],
          ["roles", value.roles],
          ["relations", value.relationships]
        ];
        return parts.map(function (part) {
          return part[0] + " " + (Array.isArray(part[1]) ? part[1].length : 0);
        }).join(", ");
      }

      function eligibilityTitle(value) {
        if (!value || typeof value !== "object") return "";
        return Object.keys(value).map(function (key) {
          return key + ": " + (Array.isArray(value[key]) ? value[key].join(" / ") : String(value[key]));
        }).join("; ");
      }

      function renderSources() {
        var query = sourceSearch.value.trim().toLocaleLowerCase();
        var approval = approvalFilter.value;
        var filtered = documents.filter(function (doc) {
          var queryMatches = !query || JSON.stringify(doc).toLocaleLowerCase().includes(query);
          var approvalMatches = !approval || doc.approval === approval;
          return queryMatches && approvalMatches;
        });

        sourceRows.replaceChildren();
        if (!filtered.length) {
          var stateRow = document.createElement("tr");
          stateRow.className = "table-state";
          var stateCell = document.createElement("td");
          stateCell.colSpan = 11;
          stateCell.textContent = documents.length ? "no sources match these filters" : "no source inventory available";
          stateRow.appendChild(stateCell);
          sourceRows.appendChild(stateRow);
        }

        filtered.forEach(function (doc) {
          var row = document.createElement("tr");
          var effective = doc.effectiveTo ? doc.effectiveFrom + " to " + doc.effectiveTo : doc.effectiveFrom;
          textCell(row, doc.sourceId + " @ " + doc.versionId, true);
          textCell(row, doc.title, false);
          textCell(row, doc.domain, false);
          textCell(row, doc.sourceType, false);
          textCell(row, doc.originalFormat, true);
          textCell(row, doc.extractionMode + (doc.ocrReviewed ? " / reviewed" : ""), true);
          textCell(row, doc.approval, false);
          textCell(row, doc.policySensitivity, false);
          textCell(row, effective, true);
          textCell(row, eligibilitySummary(doc.eligibility), false, eligibilityTitle(doc.eligibility));
          textCell(row, doc.contentBytes, true);
          sourceRows.appendChild(row);
        });

        inventoryCount.textContent = filtered.length + (filtered.length === 1 ? " source" : " sources");
      }

      async function loadSources() {
        sourceRows.replaceChildren();
        var row = document.createElement("tr");
        row.className = "table-state";
        var cell = document.createElement("td");
        cell.colSpan = 11;
        cell.textContent = "loading source inventory";
        row.appendChild(cell);
        sourceRows.appendChild(row);
        try {
          var payload = await getJson("/api/corpus");
          documents = Array.isArray(payload.documents) ? payload.documents : [];
          byId("inventory-state").textContent = "metadata loaded";
          renderSources();
        } catch (error) {
          documents = [];
          cell.textContent = error instanceof Error ? error.message : String(error);
          byId("inventory-state").textContent = "metadata unavailable";
          inventoryCount.textContent = "unavailable";
        }
      }

      async function loadProfiles() {
        try {
          var payload = await getJson("/api/profiles");
          profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
          if (!profiles.length) throw new Error("Profile registry is empty");
          activeProfile = profiles[0];
          profileLoadError = "";
        } catch (error) {
          profiles = [];
          activeProfile = null;
          profileLoadError = error instanceof Error ? error.message : String(error);
        }
      }

      function addHandoffItem(list, label, value) {
        var wrapper = document.createElement("div");
        var term = document.createElement("dt");
        var description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value === undefined || value === null ? "n/a" : String(value);
        wrapper.appendChild(term);
        wrapper.appendChild(description);
        list.appendChild(wrapper);
      }

      function renderClaims(claims) {
        var container = byId("claims");
        container.replaceChildren();
        (Array.isArray(claims) ? claims : []).forEach(function (claim) {
          var card = document.createElement("article");
          card.className = "claim-card";
          var head = document.createElement("div");
          head.className = "claim-head";
          var id = document.createElement("span");
          id.className = "claim-id";
          id.textContent = claim.id || "claim";
          var text = document.createElement("span");
          text.className = "claim-text";
          text.textContent = claim.text || "";
          head.appendChild(id);
          head.appendChild(text);
          card.appendChild(head);

          var evidenceList = document.createElement("div");
          evidenceList.className = "evidence-list";
          (Array.isArray(claim.evidence) ? claim.evidence : []).forEach(function (evidence) {
            var item = document.createElement("div");
            item.className = "evidence";
            var meta = document.createElement("div");
            meta.className = "evidence-meta";
            meta.textContent = (evidence.sourceId || "source") + " @ " + (evidence.versionId || "version") + " / bytes " + evidence.startByte + "-" + evidence.endByte + " / " + (evidence.quoteSha256 || "hash missing");
            var quote = document.createElement("blockquote");
            quote.textContent = evidence.quote || "";
            item.appendChild(meta);
            item.appendChild(quote);
            evidenceList.appendChild(item);
          });
          card.appendChild(evidenceList);
          container.appendChild(card);
        });
      }

      function cancelTraceRequest() {
        if (activeTraceController) activeTraceController.abort();
        activeTraceController = null;
      }

      function closeTracePanel() {
        byId("trace-details").hidden = true;
        byId("trace-details").open = false;
        byId("trace-json").textContent = "";
        traceButton.setAttribute("aria-expanded", "false");
        traceButton.textContent = "trace";
      }

      function showDecision(payload, elapsedMs) {
        cancelTraceRequest();
        responsePayload = payload;
        traceId = payload && typeof payload.traceId === "string" ? payload.traceId : "";
        byId("decision-shell").hidden = false;
        byId("response-actions").hidden = false;
        byId("payload-details").hidden = false;
        closeTracePanel();

        var kind = payload && payload.kind ? String(payload.kind) : "unknown";
        var kindLabel = byId("decision-kind");
        kindLabel.textContent = "> " + kind;
        kindLabel.dataset.kind = kind;
        byId("decision-latency").textContent = elapsedMs + " ms";
        byId("decision-trace").textContent = "trace " + (traceId ? traceId.slice(0, 16) : "n/a");
        byId("decision-score").textContent = Number.isFinite(payload.answerabilityScore)
          ? "score " + payload.answerabilityScore.toFixed(2)
          : "score n/a";
        byId("response-json").textContent = JSON.stringify(payload, null, 2);

        var claimsSection = byId("claims-section");
        var handoffSection = byId("handoff-section");
        claimsSection.hidden = true;
        handoffSection.hidden = true;
        byId("claims").replaceChildren();
        byId("handoff").replaceChildren();

        if (kind === "answer") {
          byId("decision-message").textContent = payload.body || "";
          renderClaims(payload.claims);
          claimsSection.hidden = false;
        } else if (kind === "defer") {
          byId("decision-message").textContent = payload.userMessage || "";
          var handoff = payload.handoff || {};
          var list = byId("handoff");
          addHandoffItem(list, "ticket", handoff.ticketId);
          addHandoffItem(list, "reason", handoff.reasonCode);
          addHandoffItem(list, "queue", handoff.queue);
          addHandoffItem(list, "sla", handoff.slaHours ? handoff.slaHours + " hours" : "n/a");
          addHandoffItem(list, "idempotency", handoff.idempotencyKey);
          handoffSection.hidden = false;
        } else {
          byId("decision-message").textContent = payload.body || "";
        }

        copyButton.disabled = false;
        traceButton.disabled = !traceId;
        decisionAnnouncer.textContent = "Decision ready: " + kind;
      }

      function resizeQuestion() {
        questionInput.style.height = "auto";
        var nextHeight = Math.min(questionInput.scrollHeight, 110);
        questionInput.style.height = Math.max(nextHeight, 22) + "px";
        questionInput.style.overflowY = questionInput.scrollHeight > 110 ? "auto" : "hidden";
      }

      async function submitQuestion(question) {
        if (inFlight) return;
        formError.textContent = "";
        if (!activeProfile) {
          await loadProfiles();
        }
        if (!activeProfile) {
          formError.textContent = profileLoadError
            ? "Requester context unavailable."
            : "Requester context is still loading.";
          return;
        }

        var logicalKey = JSON.stringify([
          activeProfile.profileId,
          activeProfile.legalEntityId,
          activeProfile.baseId,
          activeProfile.relationship,
          activeProfile.role,
          question.normalize("NFKC").trim().toLocaleLowerCase("pt-BR")
        ]);
        var requestId = logicalRequestIds.get(logicalKey);
        if (!requestId) {
          requestId = newId("req");
          logicalRequestIds.set(logicalKey, requestId);
        }
        var payload = {
          requestId: requestId,
          question: question,
          asOf: new Date().toISOString(),
          requester: {
            subjectId: "subject-" + activeProfile.profileId,
            legalEntityId: activeProfile.legalEntityId,
            baseId: activeProfile.baseId,
            relationship: activeProfile.relationship,
            role: activeProfile.role,
            domains: []
          }
        };

        cancelTraceRequest();
        closeTracePanel();
        traceButton.disabled = true;
        feedback([{ text: "$ ask " + question, className: "dim" }]);
        questionInput.value = "";
        resizeQuestion();
        inFlight = true;
        runButton.disabled = true;
        runButton.textContent = "Running";
        var started = performance.now();
        var controller = new AbortController();
        activeController = controller;
        cancelReason = "";
        var timeout = setTimeout(function () {
          cancelReason = "timeout";
          controller.abort();
        }, 25000);
        try {
          var decision = await getJson("/v1/decide", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          showDecision(decision, Math.round(performance.now() - started));
        } catch (error) {
          if (error && error.name === "AbortError") {
            formError.textContent = cancelReason === "cancelled"
              ? "Request cancelled."
              : "Request timed out after 25 seconds.";
          } else {
            formError.textContent = error instanceof Error ? error.message : String(error);
          }
        } finally {
          clearTimeout(timeout);
          activeController = null;
          cancelReason = "";
          inFlight = false;
          runButton.disabled = false;
          runButton.textContent = "Run question";
          if (traceId) traceButton.disabled = false;
          questionInput.focus();
        }
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (inFlight) return;
        var raw = questionInput.value.trim();
        if (!raw) {
          formError.textContent = "Type a question or command.";
          return;
        }
        var command = commandFrom(raw);
        if (command && command.name !== "ask") {
          runCommand(command);
          questionInput.value = "";
          resizeQuestion();
          if (command.name !== "sources") {
            requestAnimationFrame(function () { questionInput.scrollIntoView({ block: "nearest" }); });
          }
          return;
        }
        var question = command ? command.args : raw;
        if (!question) {
          formError.textContent = "usage: ask <question>";
          return;
        }
        submitQuestion(question);
      });

      questionInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          form.requestSubmit();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
          if (questionInput.selectionStart !== questionInput.selectionEnd) return;
          if (window.getSelection && String(window.getSelection())) return;
          if (activeController) {
            event.preventDefault();
            cancelReason = "cancelled";
            activeController.abort();
          }
          return;
        }
        if (event.ctrlKey && event.key.toLowerCase() === "l") {
          event.preventDefault();
          commandFeedback.replaceChildren();
          return;
        }
        if (event.key === "Tab") {
          var value = questionInput.value.trim();
          if (!value || /\\s/.test(value)) return;
          var hits = COMMANDS.filter(function (name) { return name.startsWith(value.toLowerCase()); });
          if (hits.length === 1) {
            event.preventDefault();
            questionInput.value = hits[0] + " ";
          }
          return;
        }
        if (event.key === "ArrowUp" && commandHistory.length) {
          if (historyIndex === -1 && questionInput.value) return;
          if (historyIndex !== -1 && questionInput.value !== commandHistory[historyIndex]) {
            historyIndex = -1;
            return;
          }
          event.preventDefault();
          historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
          questionInput.value = commandHistory[historyIndex];
          return;
        }
        if (event.key === "ArrowDown" && historyIndex !== -1) {
          if (questionInput.value !== commandHistory[historyIndex]) {
            historyIndex = -1;
            return;
          }
          event.preventDefault();
          historyIndex -= 1;
          questionInput.value = historyIndex === -1 ? "" : commandHistory[historyIndex];
        }
      });
      questionInput.addEventListener("input", resizeQuestion);

      copyButton.addEventListener("click", async function () {
        if (!responsePayload) return;
        try {
          if (!navigator.clipboard) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(JSON.stringify(responsePayload, null, 2));
          copyButton.textContent = "copied";
        } catch (_) { copyButton.textContent = "copy failed"; }
        setTimeout(function () { copyButton.textContent = "copy payload"; }, 1200);
      });

      traceButton.addEventListener("click", async function () {
        if (!traceId) return;
        cancelTraceRequest();
        var requestedTraceId = traceId;
        var controller = new AbortController();
        activeTraceController = controller;
        traceButton.disabled = true;
        traceButton.textContent = "loading trace";
        try {
          var payload = await getJson("/v1/traces/" + encodeURIComponent(requestedTraceId), { signal: controller.signal });
          if (activeTraceController !== controller || traceId !== requestedTraceId) return;
          byId("trace-json").textContent = JSON.stringify(payload, null, 2);
          byId("trace-details").hidden = false;
          byId("trace-details").open = true;
          traceButton.setAttribute("aria-expanded", "true");
        } catch (error) {
          if ((error && error.name === "AbortError") || activeTraceController !== controller || traceId !== requestedTraceId) return;
          byId("trace-json").textContent = error instanceof Error ? error.message : String(error);
          byId("trace-details").hidden = false;
          byId("trace-details").open = true;
          traceButton.setAttribute("aria-expanded", "true");
        } finally {
          if (activeTraceController === controller) {
            activeTraceController = null;
            traceButton.disabled = false;
            traceButton.textContent = "trace";
          }
        }
      });

      sourceSearch.addEventListener("input", renderSources);
      approvalFilter.addEventListener("change", renderSources);
      byId("refresh-sources").addEventListener("click", loadSources);
      skipLink.addEventListener("click", function (event) {
        event.preventDefault();
        completeBoot(true);
        questionInput.focus({ preventScroll: true });
      });
      document.addEventListener("keydown", guardBootFocus, true);

      resizeQuestion();
      window.__gauntletRuntimeReady = true;
      scheduleBoot();
      checkService("/healthz", byId("health-state"), "health");
      checkService("/readyz", byId("ready-state"), "ready");
      loadProfiles();
      loadSources();
    }());
  </script>
</body>
</html>`;
}
