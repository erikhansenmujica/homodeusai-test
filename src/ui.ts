export function renderWorkbench(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" data-testid="document-encoding">
  <meta name="viewport" data-testid="viewport-policy" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#17362e">
  <title>Mesa de decisões · Nexo Atlântico</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f2eee4;
      --paper-deep: #e7e0d2;
      --card: #fbf9f3;
      --ink: #172720;
      --ink-soft: #526059;
      --forest: #17362e;
      --forest-soft: #2f5548;
      --coral: #d96442;
      --coral-pale: #f5ded3;
      --gold: #c89d49;
      --line: #d8d0c1;
      --ok: #2f7356;
      --warn: #a64e35;
      --shadow: 0 20px 60px rgba(34, 43, 36, .09);
      --serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      --sans: "Avenir Next", Avenir, "Segoe UI", sans-serif;
      --mono: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
    }

    * { box-sizing: border-box; }
    html { min-width: 320px; background: var(--forest); scroll-behavior: smooth; }
    body {
      min-width: 320px;
      min-height: 100dvh;
      margin: 0;
      background:
        radial-gradient(circle at 73% 8%, rgba(200, 157, 73, .14), transparent 28rem),
        linear-gradient(100deg, rgba(23, 54, 46, .04) 1px, transparent 1px),
        var(--paper);
      background-size: auto, 58px 58px, auto;
      color: var(--ink);
      font: 15px/1.55 var(--sans);
      -webkit-font-smoothing: antialiased;
    }
    button, textarea, select, input { font: inherit; }
    button, summary, select { cursor: pointer; }
    button:focus-visible, textarea:focus-visible, select:focus-visible, input:focus-visible, [tabindex="0"]:focus-visible {
      outline: 3px solid rgba(217, 100, 66, .35);
      outline-offset: 3px;
    }
    [hidden] { display: none !important; }
    ::selection { color: white; background: var(--coral); }

    .skip {
      position: fixed;
      z-index: 30;
      left: 1rem;
      top: 1rem;
      transform: translateY(-180%);
      padding: .65rem 1rem;
      border-radius: 999px;
      background: var(--ink);
      color: white;
    }
    .skip:focus { transform: none; }

    .masthead {
      min-height: 74px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 0 clamp(1rem, 3vw, 3.25rem);
      border-bottom: 1px solid rgba(255, 255, 255, .1);
      background: var(--forest);
      color: white;
    }
    .wordmark { display: flex; align-items: center; gap: .9rem; min-width: 0; }
    .wordmark-mark {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, .45);
      border-radius: 50%;
      color: #f3c875;
      font: 700 15px/1 var(--serif);
    }
    .wordmark-text { min-width: 0; }
    .wordmark-text strong {
      display: block;
      font: 600 16px/1.1 var(--serif);
      letter-spacing: .02em;
    }
    .wordmark-text span {
      display: block;
      margin-top: .22rem;
      color: rgba(255,255,255,.62);
      font-size: 10px;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    .service-pill {
      display: flex;
      align-items: center;
      gap: .55rem;
      color: rgba(255,255,255,.76);
      font-size: 12px;
    }
    .service-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--gold);
      box-shadow: 0 0 0 4px rgba(200,157,73,.14);
    }
    .service-pill[data-state="ok"] .service-dot { background: #7ac39f; box-shadow: 0 0 0 4px rgba(122,195,159,.13); }
    .service-pill[data-state="error"] .service-dot { background: #f18a69; }

    .workbench {
      width: min(1560px, 100%);
      min-height: calc(100dvh - 74px);
      margin: 0 auto;
      display: grid;
      grid-template-columns: 230px minmax(0, 1fr) 330px;
    }
    .left-rail {
      padding: 2rem 1.35rem 2.5rem;
      border-right: 1px solid var(--line);
    }
    .rail-label, .eyebrow {
      margin: 0 0 .7rem;
      color: var(--coral);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    .profile-card {
      margin-bottom: 2rem;
      padding: 1.1rem;
      border: 1px solid var(--line);
      border-radius: 2px 18px 2px 2px;
      background: rgba(251,249,243,.64);
    }
    .profile-card label { display: block; margin-bottom: .45rem; color: var(--ink-soft); font-size: 12px; }
    .profile-card select {
      width: 100%;
      padding: .55rem 1.8rem .55rem .1rem;
      border: 0;
      border-bottom: 1px solid var(--ink);
      border-radius: 0;
      background: transparent;
      color: var(--ink);
      font-weight: 700;
    }
    .profile-meta { margin-top: .9rem; display: grid; gap: .35rem; }
    .profile-meta span {
      overflow-wrap: anywhere;
      color: var(--ink-soft);
      font: 10.5px/1.4 var(--mono);
    }
    .rail-nav { display: grid; gap: .25rem; }
    .rail-nav a {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: .65rem .1rem;
      border-bottom: 1px solid transparent;
      color: var(--ink-soft);
      text-decoration: none;
      font-size: 13px;
    }
    .rail-nav a:hover { border-color: var(--line); color: var(--ink); }
    .rail-nav a span { color: var(--coral); font: 10px var(--mono); }
    .trust-note {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--line);
      color: var(--ink-soft);
      font-size: 11px;
    }
    .trust-note strong { color: var(--ink); }

    .main-stage {
      min-width: 0;
      padding: clamp(2rem, 5vw, 4.5rem) clamp(1.25rem, 4vw, 4.25rem) 5rem;
    }
    .hero { max-width: 860px; margin-bottom: 2.3rem; }
    .hero h1 {
      max-width: 780px;
      margin: 0;
      font: 500 clamp(2.75rem, 5vw, 5.6rem)/.93 var(--serif);
      letter-spacing: -.055em;
    }
    .hero h1 em { color: var(--coral); font-weight: 500; }
    .hero p {
      max-width: 620px;
      margin: 1.35rem 0 0;
      color: var(--ink-soft);
      font-size: 16px;
    }

    .composer {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 2px 26px 2px 2px;
      background: var(--card);
      box-shadow: var(--shadow);
    }
    .composer::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--coral);
    }
    .composer-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem .2rem 1.5rem;
      color: var(--ink-soft);
      font-size: 11px;
    }
    .composer-top strong { color: var(--ink); letter-spacing: .06em; text-transform: uppercase; }
    .question-input {
      width: 100%;
      min-height: 116px;
      max-height: 260px;
      padding: 1rem 1.5rem;
      border: 0;
      resize: vertical;
      background: transparent;
      color: var(--ink);
      font: 500 clamp(1.25rem, 2vw, 1.7rem)/1.35 var(--serif);
    }
    .question-input::placeholder { color: #9b978d; }
    .composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: .8rem 1.25rem 1.1rem 1.5rem;
      border-top: 1px solid var(--line);
    }
    .composer-hint { color: var(--ink-soft); font-size: 11px; }
    .primary-button {
      min-height: 44px;
      padding: .65rem 1.15rem;
      border: 1px solid var(--forest);
      border-radius: 999px;
      background: var(--forest);
      color: white;
      font-weight: 750;
      letter-spacing: .01em;
      transition: transform .18s ease, box-shadow .18s ease;
    }
    .primary-button:hover { transform: translateY(-2px); box-shadow: 0 8px 18px rgba(23,54,46,.18); }
    .primary-button[aria-busy="true"] { opacity: .7; cursor: wait; transform: none; }
    .primary-button[aria-busy="true"]::after { content: " ···"; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: .25; } }
    .form-error {
      min-height: 0;
      margin: .7rem 0 0;
      padding: 0 .2rem;
      color: var(--warn);
      font-size: 13px;
    }
    .form-error:empty { display: none; }
    .examples { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .9rem; }
    .example {
      padding: .48rem .72rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(251,249,243,.55);
      color: var(--ink-soft);
      font-size: 11px;
    }
    .example:hover { border-color: var(--coral); color: var(--ink); }

    .result-wrap { margin-top: 2rem; }
    .result-card {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 2px 22px 2px 2px;
      background: rgba(251,249,243,.82);
      animation: reveal .38s cubic-bezier(.2,.7,.2,1) both;
    }
    @keyframes reveal { from { opacity: 0; transform: translateY(9px); } }
    .result-empty {
      padding: 1.5rem;
      border: 1px dashed #cfc6b7;
      color: var(--ink-soft);
      font-size: 13px;
    }
    .decision-banner {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.1rem 1.35rem;
      border-bottom: 1px solid var(--line);
    }
    .decision-badge {
      display: inline-flex;
      align-items: center;
      gap: .45rem;
      color: var(--ok);
      font-size: 11px;
      font-weight: 850;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .decision-badge::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
    .decision-badge[data-kind="defer"] { color: var(--warn); }
    .decision-badge[data-kind="conversational"] { color: var(--forest-soft); }
    .score { color: var(--ink-soft); font: 11px var(--mono); }
    .decision-copy { padding: 1.5rem 1.35rem; }
    .decision-copy > p {
      max-width: 760px;
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 500 1.25rem/1.55 var(--serif);
    }
    .section-title {
      margin: 0 0 .85rem;
      font-size: 11px;
      letter-spacing: .13em;
      text-transform: uppercase;
    }
    .claims-panel, .handoff-panel { padding: 0 1.35rem 1.5rem; }
    .claim {
      margin-top: .7rem;
      padding: 1rem;
      border-left: 3px solid var(--gold);
      background: var(--paper);
    }
    .claim strong { display: block; margin-bottom: .4rem; font: 600 16px/1.45 var(--serif); }
    .evidence-block { margin-top: .75rem; color: var(--ink-soft); font-size: 12px; }
    .evidence-block blockquote {
      margin: .4rem 0;
      padding-left: .85rem;
      border-left: 1px solid var(--line);
      white-space: pre-wrap;
      color: var(--ink);
    }
    .link-button {
      padding: 0;
      border: 0;
      border-bottom: 1px solid currentColor;
      background: transparent;
      color: var(--forest-soft);
      font-size: 11px;
      font-weight: 700;
    }
    .handoff-receipt {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: .8rem;
      padding: 1rem;
      background: var(--coral-pale);
    }
    .receipt-item span { display: block; color: var(--ink-soft); font-size: 10px; text-transform: uppercase; letter-spacing: .1em; }
    .receipt-item strong { display: block; margin-top: .2rem; overflow-wrap: anywhere; font-size: 13px; }
    .secondary-button {
      min-height: 40px;
      margin-top: 1rem;
      padding: .55rem .9rem;
      border: 1px solid var(--forest);
      border-radius: 999px;
      background: transparent;
      color: var(--forest);
      font-weight: 750;
    }
    .secondary-button:hover { background: var(--forest); color: white; }
    .decision-tools {
      display: flex;
      align-items: center;
      gap: .8rem;
      padding: 1rem 1.35rem;
      border-top: 1px solid var(--line);
    }
    .decision-tools button { margin: 0; }

    .record, .trace {
      margin-top: 1rem;
      padding: 1.2rem;
      border: 1px solid var(--line);
      background: var(--card);
    }
    .record-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .status-chip { padding: .25rem .55rem; border-radius: 999px; background: var(--paper-deep); font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .record-grid, .trace-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: .8rem 1.3rem;
      margin: 1rem 0;
    }
    .record-grid div, .trace-grid div { min-width: 0; }
    .record-grid dt, .trace-grid dt { color: var(--ink-soft); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    .record-grid dd, .trace-grid dd { margin: .18rem 0 0; overflow-wrap: anywhere; font-size: 13px; }
    .record-question { padding: .9rem; background: var(--paper); white-space: pre-wrap; overflow-wrap: anywhere; }
    .resolution-form { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--line); }
    .resolution-form label { display: block; margin-bottom: .4rem; font-size: 12px; font-weight: 700; }
    .resolution-form textarea {
      width: 100%;
      min-height: 90px;
      padding: .75rem;
      border: 1px solid var(--line);
      background: white;
      resize: vertical;
    }
    .resolved-state { margin-top: 1rem; padding: .9rem; border-left: 3px solid var(--ok); background: #e3eee7; }
    .trace-list { margin: .5rem 0 0; padding-left: 1.1rem; color: var(--ink-soft); font-size: 12px; }

    .history { margin-top: 2.3rem; }
    .history-list { display: grid; gap: .45rem; }
    .history-empty { color: var(--ink-soft); font-size: 12px; }
    .history-row {
      display: grid;
      grid-template-columns: 78px minmax(0,1fr) auto;
      gap: .8rem;
      align-items: baseline;
      padding: .7rem 0;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
    }
    .history-row time { color: var(--ink-soft); font: 10px var(--mono); }
    .history-row p { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .history-kind { color: var(--coral); font-size: 9px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }

    .source-rail {
      min-width: 0;
      padding: 2rem 1.25rem 3rem;
      border-left: 1px solid var(--line);
      background: rgba(231,224,210,.45);
    }
    .source-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
    .source-count { color: var(--ink-soft); font: 10px var(--mono); }
    .source-search {
      width: 100%;
      margin: .7rem 0 1rem;
      padding: .65rem .1rem;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      color: var(--ink);
    }
    .source-list { display: grid; gap: .45rem; max-height: 48dvh; overflow: auto; padding-right: .25rem; }
    .source-item {
      width: 100%;
      padding: .75rem;
      border: 1px solid transparent;
      background: rgba(251,249,243,.56);
      color: var(--ink);
      text-align: left;
    }
    .source-item:hover, .source-item[aria-current="true"] { border-color: var(--coral); background: var(--card); }
    .source-item strong { display: block; overflow-wrap: anywhere; font: 600 13px/1.35 var(--serif); }
    .source-item span { display: block; margin-top: .35rem; color: var(--ink-soft); font: 9.5px/1.35 var(--mono); }
    .source-detail {
      margin-top: 1.4rem;
      padding-top: 1.2rem;
      border-top: 1px solid var(--line);
    }
    .source-detail h3 { margin: 0; overflow-wrap: anywhere; font: 600 19px/1.2 var(--serif); }
    .source-detail dl { display: grid; grid-template-columns: 86px minmax(0,1fr); gap: .45rem .7rem; margin: 1rem 0 0; font-size: 11px; }
    .source-detail dt { color: var(--ink-soft); }
    .source-detail dd { margin: 0; overflow-wrap: anywhere; }
    .governance-stamp { display: inline-block; margin-top: .8rem; padding: .28rem .5rem; border: 1px solid var(--line); font: 9px var(--mono); text-transform: uppercase; }

    @media (max-width: 1120px) {
      .workbench { grid-template-columns: 205px minmax(0,1fr); }
      .source-rail { grid-column: 1 / -1; border: 1px solid var(--line); border-width: 1px 0 0; }
      .source-list { grid-template-columns: repeat(3, minmax(0,1fr)); max-height: 320px; }
    }
    @media (max-width: 720px) {
      .masthead { min-height: 64px; padding: 0 1rem; }
      .wordmark-text span { display: none; }
      .workbench { display: block; min-height: 0; }
      .left-rail { padding: 1rem; border: 0; border-bottom: 1px solid var(--line); }
      .profile-card { margin: 0; padding: .8rem; }
      .rail-nav, .trust-note, .rail-label { display: none; }
      .main-stage { padding: 2.2rem 1rem 3rem; }
      .hero h1 { font-size: clamp(2.7rem, 14vw, 4.6rem); }
      .hero p { font-size: 14px; }
      .composer-actions { align-items: flex-end; }
      .composer-hint { max-width: 130px; }
      .decision-banner, .decision-copy, .claims-panel, .handoff-panel, .decision-tools { padding-left: 1rem; padding-right: 1rem; }
      .handoff-receipt, .record-grid, .trace-grid { grid-template-columns: 1fr; }
      .history-row { grid-template-columns: 62px minmax(0,1fr); }
      .history-kind { grid-column: 2; }
      .source-rail { padding: 1.5rem 1rem 2.5rem; }
      .source-list { grid-template-columns: 1fr; max-height: 380px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <a class="skip" href="#request-form">Ir para a consulta</a>
  <header class="masthead">
    <div class="wordmark">
      <div class="wordmark-mark" aria-hidden="true">NA</div>
      <div class="wordmark-text"><strong>Nexo Atlântico</strong><span>Mesa de decisões · People Operations</span></div>
    </div>
    <div id="service-state" class="service-pill" data-state="loading"><span class="service-dot"></span><span id="service-label">Preparando fontes</span></div>
  </header>

  <main class="workbench" data-testid="decision-workbench">
    <aside class="left-rail" aria-label="Contexto da sessão">
      <p class="rail-label">Sessão confiável</p>
      <section class="profile-card">
        <label for="profile-select">Perfil do solicitante</label>
        <select id="profile-select" aria-label="Perfil confiável"></select>
        <label for="effective-date" style="margin-top:.9rem">Data de vigência</label>
        <input id="effective-date" data-testid="effective-date" type="date" aria-label="Data de vigência">
        <div id="profile-meta" class="profile-meta"></div>
      </section>
      <nav class="rail-nav" aria-label="Atalhos">
        <a href="#request-form">Nova decisão <span>01</span></a>
        <a href="#decision-history">Histórico <span>02</span></a>
        <a href="#source-inventory">Fontes <span>03</span></a>
      </nav>
      <p class="trust-note"><strong>Limite de confiança.</strong> Entidade, base e vínculo vêm da sessão. A pergunta nunca altera esse contexto.</p>
    </aside>

    <section class="main-stage">
      <header class="hero">
        <p class="eyebrow">Decisão governada · não apenas busca</p>
        <h1>Respostas com <em>recibo.</em></h1>
        <p>Consulte o acervo de People Operations. Quando a evidência não for suficiente, a mesa abre um caso com responsável, prazo e contexto preservado.</p>
      </header>

      <form id="request-form" class="composer" data-testid="request-form">
        <div class="composer-top"><strong>Nova consulta</strong><span id="as-of-label">agora</span></div>
        <label for="question-input" style="position:absolute;left:-10000px">Pergunta de People Operations</label>
        <textarea id="question-input" class="question-input" data-testid="question-input" rows="3" required maxlength="12000" placeholder="O que você precisa decidir?"></textarea>
        <div class="composer-actions">
          <span class="composer-hint">Enter envia · Shift + Enter quebra a linha</span>
          <button id="submit-decision" class="primary-button" data-testid="submit-decision" type="submit" aria-busy="false">Verificar evidência</button>
        </div>
      </form>
      <div id="error-state" class="form-error" role="alert" data-testid="error-state"></div>
      <div class="examples" aria-label="Consultas de exemplo">
        <button class="example" type="button">Quando o comprovante fica disponível?</button>
        <button class="example" type="button">Posso enviar dados bancários no chat?</button>
        <button class="example" type="button">Quero falar com uma pessoa.</button>
      </div>

      <section id="decision-result" class="result-wrap" data-testid="decision-result" aria-live="polite">
        <div class="result-empty">A próxima decisão aparecerá aqui, com evidência elegível ou um handoff operacional completo.</div>
      </section>

      <section id="decision-history" class="history" data-testid="decision-history">
        <p class="eyebrow">Nesta sessão</p>
        <div id="history-list" class="history-list"><p class="history-empty">Nenhuma decisão recente.</p></div>
      </section>
    </section>

    <aside id="source-inventory" class="source-rail" data-testid="source-inventory" aria-label="Inventário de fontes">
      <div class="source-head"><p class="eyebrow">Acervo governado</p><span id="source-count" class="source-count">0 fontes</span></div>
      <label for="source-search" style="position:absolute;left:-10000px">Filtrar fontes</label>
      <input id="source-search" class="source-search" type="search" placeholder="Filtrar por título ou domínio">
      <div id="source-list" class="source-list"></div>
      <section id="source-detail" class="source-detail" data-testid="source-detail">
        <h3>Selecione uma fonte</h3>
        <p style="color:var(--ink-soft);font-size:12px">Aqui aparecem somente metadados e controles de governança.</p>
      </section>
    </aside>
  </main>

  <script>
    (function () {
      "use strict";
      var profiles = [];
      var documents = [];
      var currentDecision = null;
      var currentQuestion = "";
      var historyRows = [];
      var sessionId = "desk-" + Math.random().toString(16).slice(2);

      function byId(id) { return document.getElementById(id); }
      function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
      function text(tag, value, className) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        node.textContent = value == null ? "" : String(value);
        return node;
      }
      function button(label, className, testId) {
        var node = text("button", label, className);
        node.type = "button";
        if (testId) node.setAttribute("data-testid", testId);
        return node;
      }
      async function request(path, options) {
        var response = await fetch(path, options);
        var raw = await response.text();
        var payload;
        try { payload = raw ? JSON.parse(raw) : {}; } catch (_error) { throw new Error("O serviço retornou uma resposta inválida."); }
        if (!response.ok) throw new Error(payload.message || payload.error || "Não foi possível concluir a solicitação.");
        return payload;
      }
      function formatDate(value) {
        try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
        catch (_error) { return String(value || ""); }
      }
      function selectedProfile() {
        var id = byId("profile-select").value;
        return profiles.find(function (profile) { return profile.profileId === id; }) || profiles[0];
      }
      function renderProfile() {
        var profile = selectedProfile();
        var meta = byId("profile-meta");
        clear(meta);
        if (!profile) return;
        meta.append(
          text("span", profile.legalEntityId + " · " + profile.baseId),
          text("span", profile.relationship + " · " + profile.role)
        );
      }
      function renderProfiles(payload) {
        profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
        var select = byId("profile-select");
        clear(select);
        profiles.forEach(function (profile) {
          var option = text("option", profile.profileId.replace(/-/g, " "));
          option.value = profile.profileId;
          select.appendChild(option);
        });
        var preferred = profiles.find(function (profile) { return profile.profileId === "employee-na-servicos-sudeste"; });
        if (preferred) select.value = preferred.profileId;
        renderProfile();
        var date = byId("effective-date");
        if (!date.value) date.value = new Date().toISOString().slice(0, 10);
      }
      function sourceSummary(doc) {
        return doc.domain + " · " + doc.approval + " · tier " + doc.authorityTier;
      }
      function showSource(sourceId) {
        var doc = documents.find(function (item) { return item.sourceId === sourceId; });
        if (!doc) return;
        document.querySelectorAll(".source-item").forEach(function (item) {
          item.setAttribute("aria-current", item.getAttribute("data-source-id") === sourceId ? "true" : "false");
        });
        var panel = byId("source-detail");
        clear(panel);
        panel.appendChild(text("h3", doc.title));
        var dl = document.createElement("dl");
        [
          ["ID", doc.sourceId],
          ["Versão", doc.versionId],
          ["Domínio", doc.domain],
          ["Tipo", doc.sourceType],
          ["Audiência", doc.audience],
          ["Aprovação", doc.approval],
          ["Vigência", doc.effectiveFrom + (doc.effectiveTo ? " — " + doc.effectiveTo : "")],
          ["Sensibilidade", doc.policySensitivity],
          ["Autoridade", doc.authorityTier],
          ["Extração", doc.extractionMode + (doc.ocrReviewed ? " · OCR revisado" : "")],
        ].forEach(function (row) {
          dl.append(text("dt", row[0]), text("dd", row[1]));
        });
        panel.appendChild(dl);
        panel.appendChild(text("span", doc.approval + " · " + doc.audience, "governance-stamp"));
        if (window.innerWidth < 1120) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      function renderSources(filter) {
        var list = byId("source-list");
        clear(list);
        var needle = String(filter || "").toLocaleLowerCase("pt-BR").trim();
        var visible = documents.filter(function (doc) {
          return !needle || (doc.title + " " + doc.domain + " " + doc.sourceId).toLocaleLowerCase("pt-BR").includes(needle);
        });
        visible.forEach(function (doc) {
          var item = button("", "source-item");
          item.setAttribute("data-source-id", doc.sourceId);
          item.append(text("strong", doc.title), text("span", sourceSummary(doc)));
          item.addEventListener("click", function () { showSource(doc.sourceId); });
          list.appendChild(item);
        });
        byId("source-count").textContent = visible.length + " fontes";
      }
      function renderCorpus(payload) {
        documents = Array.isArray(payload.documents) ? payload.documents : [];
        renderSources("");
        if (documents[0]) showSource(documents[0].sourceId);
      }
      function resultShell(kind, score) {
        var card = document.createElement("article");
        card.className = "result-card";
        var banner = document.createElement("header");
        banner.className = "decision-banner";
        var labels = { answer: "Resposta sustentada", defer: "Revisão humana", conversational: "Conversa" };
        var badge = text("span", labels[kind] || kind, "decision-badge");
        badge.setAttribute("data-kind", kind);
        banner.appendChild(badge);
        if (typeof score === "number") banner.appendChild(text("span", Math.round(score * 100) + "% answerability", "score"));
        card.appendChild(banner);
        return card;
      }
      function addDecisionTools(card, decision) {
        var tools = document.createElement("div");
        tools.className = "decision-tools";
        var traceButton = button("Abrir trilha de decisão", "secondary-button", "trace-trigger");
        traceButton.id = "trace-trigger";
        traceButton.addEventListener("click", function () { loadTrace(decision.traceId); });
        tools.appendChild(traceButton);
        card.appendChild(tools);
        var trace = document.createElement("section");
        trace.id = "trace-panel";
        trace.className = "trace";
        trace.hidden = true;
        trace.setAttribute("data-testid", "trace-panel");
        card.appendChild(trace);
      }
      function renderAnswer(decision) {
        var card = resultShell("answer", decision.answerabilityScore);
        var copy = document.createElement("div");
        copy.className = "decision-copy";
        copy.appendChild(text("p", decision.body));
        card.appendChild(copy);
        var panel = document.createElement("section");
        panel.className = "claims-panel";
        panel.setAttribute("data-testid", "claims-panel");
        panel.appendChild(text("h2", "Claims verificáveis", "section-title"));
        (decision.claims || []).forEach(function (claim) {
          var claimCard = document.createElement("article");
          claimCard.className = "claim";
          claimCard.appendChild(text("strong", claim.text));
          (claim.evidence || []).forEach(function (evidence) {
            var block = document.createElement("div");
            block.className = "evidence-block";
            block.appendChild(text("span", evidence.sourceId + " · " + evidence.versionId + " · bytes " + evidence.startByte + "–" + evidence.endByte));
            block.appendChild(text("blockquote", evidence.quote));
            var sourceButton = button("Ver governança da fonte", "link-button", "evidence-source-link");
            sourceButton.addEventListener("click", function () {
              showSource(evidence.sourceId);
              byId("source-inventory").scrollIntoView({ behavior: "smooth", block: "start" });
            });
            block.appendChild(sourceButton);
            claimCard.appendChild(block);
          });
          panel.appendChild(claimCard);
        });
        card.appendChild(panel);
        addDecisionTools(card, decision);
        return card;
      }
      function receiptItem(label, value) {
        var item = document.createElement("div");
        item.className = "receipt-item";
        item.append(text("span", label), text("strong", value));
        return item;
      }
      function renderDefer(decision) {
        var card = resultShell("defer", decision.answerabilityScore);
        var copy = document.createElement("div");
        copy.className = "decision-copy";
        copy.appendChild(text("p", decision.userMessage));
        card.appendChild(copy);
        var panel = document.createElement("section");
        panel.className = "handoff-panel";
        panel.setAttribute("data-testid", "handoff-panel");
        panel.appendChild(text("h2", "Recibo operacional", "section-title"));
        var receipt = document.createElement("div");
        receipt.className = "handoff-receipt";
        receipt.append(
          receiptItem("Ticket", decision.handoff.ticketId),
          receiptItem("Motivo", decision.handoff.reasonCode),
          receiptItem("Responsável", decision.handoff.queue),
          receiptItem("SLA", decision.handoff.slaHours + " horas")
        );
        panel.appendChild(receipt);
        var openButton = button("Abrir caso completo", "secondary-button", "handoff-open");
        openButton.addEventListener("click", function () { openHandoff(decision.handoff.ticketId); });
        panel.appendChild(openButton);
        var record = document.createElement("section");
        record.id = "handoff-record";
        record.className = "record";
        record.hidden = true;
        record.setAttribute("data-testid", "handoff-record");
        panel.appendChild(record);
        card.appendChild(panel);
        addDecisionTools(card, decision);
        return card;
      }
      function renderConversational(decision) {
        var card = resultShell("conversational");
        var copy = document.createElement("div");
        copy.className = "decision-copy";
        copy.appendChild(text("p", decision.body));
        card.appendChild(copy);
        addDecisionTools(card, decision);
        return card;
      }
      function renderDecision(decision) {
        currentDecision = decision;
        var target = byId("decision-result");
        clear(target);
        if (decision.kind === "answer") target.appendChild(renderAnswer(decision));
        else if (decision.kind === "defer") target.appendChild(renderDefer(decision));
        else target.appendChild(renderConversational(decision));
      }
      function addRecordField(dl, label, value) {
        dl.append(text("dt", label), text("dd", value));
      }
      function renderResolved(record, panel) {
        var resolved = text("div", "", "resolved-state");
        resolved.setAttribute("data-testid", "handoff-resolved-state");
        resolved.append(
          text("strong", "Caso concluído"),
          text("p", record.resolution ? record.resolution.summary : "Resolução registrada.")
        );
        panel.appendChild(resolved);
      }
      function renderHandoffRecord(record) {
        var panel = byId("handoff-record");
        clear(panel);
        panel.hidden = false;
        var head = document.createElement("div");
        head.className = "record-head";
        head.append(text("h3", "Caso " + record.ticketId), text("span", record.status, "status-chip"));
        panel.appendChild(head);
        var dl = document.createElement("dl");
        dl.className = "record-grid";
        addRecordField(dl, "Fila", record.queue);
        addRecordField(dl, "Prazo", record.slaHours + " horas");
        addRecordField(dl, "Motivo", record.reasonCode);
        addRecordField(dl, "Atualizado", formatDate(record.updatedAt));
        addRecordField(dl, "Próxima ação", record.nextAction);
        addRecordField(dl, "Lacuna", (record.evidenceGaps || []).join(" · "));
        panel.appendChild(dl);
        panel.append(text("h4", "Pedido preservado", "section-title"), text("div", record.request.question, "record-question"));
        if (record.status === "resolved") {
          renderResolved(record, panel);
          return;
        }
        var form = document.createElement("form");
        form.className = "resolution-form";
        form.setAttribute("data-testid", "handoff-resolution-form");
        var label = text("label", "Resumo da resolução");
        label.htmlFor = "handoff-resolution-summary";
        var summary = document.createElement("textarea");
        summary.id = "handoff-resolution-summary";
        summary.required = true;
        summary.maxLength = 4000;
        summary.setAttribute("data-testid", "handoff-resolution-summary");
        summary.placeholder = "Registre a evidência validada e o próximo passo enviado ao solicitante.";
        var submit = button("Concluir caso", "primary-button", "handoff-resolve");
        submit.type = "submit";
        form.append(label, summary, submit);
        form.addEventListener("submit", async function (event) {
          event.preventDefault();
          submit.setAttribute("aria-busy", "true");
          submit.disabled = true;
          try {
            var updated = await request("/v1/handoffs/" + encodeURIComponent(record.ticketId) + "/resolve", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ actorId: "operator-" + sessionId, summary: summary.value.trim() })
            });
            renderHandoffRecord(updated);
          } catch (error) {
            byId("error-state").textContent = error instanceof Error ? error.message : String(error);
          } finally {
            submit.setAttribute("aria-busy", "false");
            submit.disabled = false;
          }
        });
        panel.appendChild(form);
      }
      async function openHandoff(ticketId) {
        byId("error-state").textContent = "";
        try {
          var record = await request("/v1/handoffs/" + encodeURIComponent(ticketId));
          renderHandoffRecord(record);
          byId("handoff-record").scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (error) {
          byId("error-state").textContent = error instanceof Error ? error.message : String(error);
        }
      }
      function traceField(grid, label, value) {
        var wrapper = document.createElement("div");
        var dl = document.createElement("dl");
        dl.append(text("dt", label), text("dd", value));
        wrapper.appendChild(dl);
        grid.appendChild(wrapper);
      }
      async function loadTrace(traceId) {
        var panel = byId("trace-panel");
        if (!panel) return;
        panel.hidden = false;
        clear(panel);
        panel.appendChild(text("p", "Carregando trilha…", "history-empty"));
        try {
          var trace = await request("/v1/traces/" + encodeURIComponent(traceId));
          clear(panel);
          panel.appendChild(text("h3", "Trilha de decisão"));
          var grid = document.createElement("div");
          grid.className = "trace-grid";
          traceField(grid, "Rota final", trace.route.kind + (trace.route.reasonCode ? " · " + trace.route.reasonCode : ""));
          traceField(grid, "Pipeline", trace.pipelineVersion);
          traceField(grid, "Candidatas", trace.governance.candidateCount);
          traceField(grid, "Elegíveis", trace.governance.eligibleCount);
          traceField(grid, "Rejeitadas", trace.governance.rejectedCount);
          traceField(grid, "Provider", trace.provider.status);
          panel.appendChild(grid);
          panel.appendChild(text("h4", "Etapas", "section-title"));
          var stages = document.createElement("ol");
          stages.className = "trace-list";
          (trace.stages || []).forEach(function (stage) { stages.appendChild(text("li", stage)); });
          panel.appendChild(stages);
          var sources = (trace.governance.eligibleSources || []).map(function (source) { return source.sourceId + "@" + source.versionId; });
          if (sources.length) panel.append(text("h4", "Fontes elegíveis", "section-title"), text("p", sources.join(" · "), "history-empty"));
          var rejected = Object.entries(trace.governance.rejectionReasons || {}).map(function (entry) { return entry[0] + " " + entry[1]; });
          if (rejected.length) panel.append(text("h4", "Rejeições", "section-title"), text("p", rejected.join(" · "), "history-empty"));
        } catch (error) {
          clear(panel);
          panel.appendChild(text("p", error instanceof Error ? error.message : String(error), "form-error"));
        }
      }
      function renderHistory() {
        var list = byId("history-list");
        clear(list);
        if (!historyRows.length) {
          list.appendChild(text("p", "Nenhuma decisão recente.", "history-empty"));
          return;
        }
        historyRows.slice(0, 8).forEach(function (row) {
          var item = document.createElement("article");
          item.className = "history-row";
          item.append(text("time", row.time), text("p", row.question), text("span", row.kind, "history-kind"));
          list.appendChild(item);
        });
      }
      async function submitQuestion(question) {
        var profile = selectedProfile();
        if (!profile) throw new Error("O perfil confiável ainda não está disponível.");
        currentQuestion = question;
        var selectedDate = byId("effective-date").value;
        var now = selectedDate ? new Date(selectedDate + "T12:00:00.000Z") : new Date();
        var requestId = "desk-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
        return request("/v1/decide", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: requestId,
            question: question,
            asOf: now.toISOString(),
            requester: {
              subjectId: sessionId + "-" + profile.profileId,
              legalEntityId: profile.legalEntityId,
              baseId: profile.baseId,
              relationship: profile.relationship,
              role: profile.role,
              domains: []
            },
            history: []
          })
        });
      }
      byId("request-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        var question = byId("question-input").value.trim();
        if (!question) return;
        var submit = byId("submit-decision");
        byId("error-state").textContent = "";
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
        byId("request-form").setAttribute("aria-busy", "true");
        try {
          var decision = await submitQuestion(question);
          renderDecision(decision);
          historyRows.unshift({ question: question, kind: decision.kind, time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) });
          renderHistory();
          byId("decision-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (error) {
          byId("error-state").textContent = error instanceof Error ? error.message : String(error);
        } finally {
          submit.disabled = false;
          submit.setAttribute("aria-busy", "false");
          byId("request-form").setAttribute("aria-busy", "false");
        }
      });
      byId("question-input").addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          byId("request-form").requestSubmit();
        }
      });
      document.querySelectorAll(".example").forEach(function (example) {
        example.addEventListener("click", function () {
          byId("question-input").value = example.textContent;
          byId("question-input").focus();
        });
      });
      byId("profile-select").addEventListener("change", renderProfile);
      byId("effective-date").addEventListener("change", function () {
        var value = byId("effective-date").value;
        byId("as-of-label").textContent = value
          ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value + "T12:00:00Z"))
          : "agora";
      });
      byId("source-search").addEventListener("input", function (event) { renderSources(event.target.value); });
      byId("as-of-label").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date());

      Promise.all([request("/healthz"), request("/api/profiles"), request("/api/corpus")])
        .then(function (payloads) {
          renderProfiles(payloads[1]);
          renderCorpus(payloads[2]);
          byId("service-state").setAttribute("data-state", "ok");
          byId("service-label").textContent = payloads[2].totals.documents + " fontes prontas";
        })
        .catch(function (error) {
          byId("service-state").setAttribute("data-state", "error");
          byId("service-label").textContent = "Serviço indisponível";
          byId("error-state").textContent = error instanceof Error ? error.message : String(error);
        });
    }());
  </script>
</body>
</html>`;
}
