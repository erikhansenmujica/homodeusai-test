export function renderWorkbench(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" data-testid="document-encoding">
  <meta name="viewport" data-testid="viewport-policy" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#17362e">
  <title>Mesa de decisões · Nexo Atlântico</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/workbench.css?v=20260724d">
  <script src="/assets/workbench.js?v=20260724e" type="module"></script>
</head>
<body>
  <a class="skip-link" href="#request-form">Ir para a consulta</a>
  <header class="masthead">
    <a class="wordmark" href="/" aria-label="Nexo Atlântico · Mesa de decisões">
      <span class="wordmark-mark" aria-hidden="true">NA</span>
      <span class="wordmark-text">
        <strong>Nexo Atlântico</strong>
        <small>Mesa de decisões · People Operations</small>
      </span>
    </a>
    <div id="service-state" class="service-pill" data-state="loading" role="status">
      <span class="service-dot" aria-hidden="true"></span>
      <span id="service-label">Preparando fontes</span>
    </div>
  </header>

  <main class="workbench" data-testid="decision-workbench">
    <aside class="left-rail" aria-labelledby="trusted-context-title">
      <div class="rail-heading">
        <p class="eyebrow">Sessão confiável</p>
        <span class="trust-lock" aria-hidden="true">◆</span>
      </div>
      <section class="profile-card">
        <h2 id="trusted-context-title">Contexto da decisão</h2>
        <label for="profile-select">Perfil confiável</label>
        <select id="profile-select"></select>
        <label for="effective-date">Data efetiva</label>
        <input id="effective-date" data-testid="effective-date" type="date">
        <dl id="profile-meta" class="profile-meta"></dl>
      </section>
      <p id="context-notice" class="context-notice" role="status" hidden></p>
      <nav class="rail-nav" aria-label="Navegação da mesa">
        <button type="button" data-new-decision>Nova decisão <span>01</span></button>
        <a href="#decision-history">Histórico <span>02</span></a>
        <a href="/sources" data-open-sources>Fontes <span>03</span></a>
      </nav>
      <p class="trust-note">
        <strong>Limite de confiança.</strong>
        Entidade, base e relacionamento vêm da sessão confiável. O texto da pergunta não pode alterar este contexto.
      </p>
    </aside>

    <section class="main-stage" aria-label="Área de decisão">
      <div id="query-zone" class="query-zone">
        <header id="hero" class="hero">
          <p class="eyebrow">Decisão governada · não apenas busca</p>
          <h1>Respostas com <em>recibo.</em></h1>
          <p>Decida com a fonte certa, no contexto certo. Quando a evidência não basta, a mesa preserva o caso e encaminha o próximo passo.</p>
        </header>

        <form id="request-form" class="composer" data-testid="request-form">
          <div class="composer-top">
            <div>
              <span class="composer-index">01</span>
              <strong>Nova consulta</strong>
            </div>
            <span id="as-of-label">agora</span>
          </div>
          <label class="sr-only" for="question-input">Pergunta de People Operations</label>
          <textarea
            id="question-input"
            class="question-input"
            data-testid="question-input"
            rows="3"
            required
            maxlength="12000"
            placeholder="O que você precisa decidir?"
          ></textarea>
          <div class="composer-actions">
            <span class="composer-hint">Enter envia · Shift + Enter quebra a linha</span>
            <button id="submit-decision" class="primary-button" data-testid="submit-decision" type="submit" aria-busy="false">
              Analisar consulta
            </button>
          </div>
        </form>

        <section id="submitted-question" class="submitted-question" hidden aria-label="Consulta submetida">
          <div>
            <p class="eyebrow">Consulta em foco</p>
            <h2 id="submitted-question-text"></h2>
          </div>
          <div class="inline-actions">
            <button id="edit-question" class="text-button" type="button">Editar consulta</button>
            <button class="secondary-button" type="button" data-new-decision>Nova decisão</button>
          </div>
        </section>

        <section id="progress-state" class="progress-card" aria-live="polite" hidden>
          <div class="progress-orbit" aria-hidden="true"><span></span></div>
          <div>
            <p class="eyebrow">Análise em andamento</p>
            <h2>Conferindo a decisão</h2>
            <ol id="progress-stages" class="progress-stages">
              <li>Procurando fontes aplicáveis</li>
              <li>Verificando escopo e vigência</li>
              <li>Validando conflitos</li>
              <li>Preparando decisão</li>
            </ol>
            <p id="slow-message" class="slow-message" hidden>A análise está levando um pouco mais de tempo. Você pode continuar nesta página; o pedido não será duplicado.</p>
          </div>
        </section>

        <section id="error-state" class="error-state" data-testid="error-state" role="alert" hidden></section>

        <div id="examples" class="examples" aria-label="Consultas de exemplo">
          <button class="example" type="button">Quando o comprovante fica disponível?</button>
          <button class="example" type="button">Posso enviar dados bancários no chat?</button>
          <button class="example" type="button">Quero falar com uma pessoa.</button>
        </div>
      </div>

      <section id="decision-result" class="decision-timeline" data-testid="decision-result" aria-live="polite">
        <div class="result-empty">
          <span aria-hidden="true">01</span>
          <p>A próxima decisão aparecerá aqui com evidência elegível ou um encaminhamento operacional completo.</p>
        </div>
      </section>

      <section id="decision-history" class="history" data-testid="decision-history">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Nesta sessão</p>
            <h2>Histórico de decisões</h2>
          </div>
          <span id="history-count" class="quiet-count">0 registros</span>
        </div>
        <div id="history-list" class="history-list">
          <p class="history-empty">Nenhuma decisão recente.</p>
        </div>
      </section>
    </section>

    <aside id="source-inventory" class="source-rail" data-testid="source-inventory" aria-labelledby="source-title">
      <div class="source-rail-top">
        <div>
          <p class="eyebrow">Acervo governado</p>
          <h2 id="source-title">Fontes da decisão</h2>
        </div>
        <button id="source-close" class="icon-button" type="button" aria-label="Fechar painel de fontes">×</button>
      </div>
      <section id="corpus-overview" class="corpus-overview">
        <p>Inventário governado para verificar autoria, vigência, escopo e aprovação.</p>
        <dl>
          <div><dt>Documentos</dt><dd id="corpus-document-count">0</dd></div>
          <div><dt>Entregas</dt><dd id="corpus-delivery-count">0</dd></div>
        </dl>
      </section>
      <label class="sr-only" for="source-search">Buscar fonte por título</label>
      <input id="source-search" class="source-search" type="search" placeholder="Buscar por título">
      <details class="source-filters">
        <summary>Filtros do acervo <span id="active-filter-count">0</span></summary>
        <div class="filter-grid">
          <label>Domínio<select id="filter-domain"><option value="">Todos</option></select></label>
          <label>Aprovação<select id="filter-approval"><option value="">Todas</option></select></label>
          <label>Audiência<select id="filter-audience"><option value="">Todas</option></select></label>
          <label>Tipo<select id="filter-type"><option value="">Todos</option></select></label>
        </div>
      </details>
      <div class="source-list-head">
        <span id="source-count">0 fontes</span>
        <button id="clear-source-filters" class="text-button" type="button">Limpar</button>
      </div>
      <div id="source-list" class="source-list"></div>
      <section id="source-detail" class="source-detail" data-testid="source-detail" tabindex="-1">
        <div class="source-detail-empty">
          <span aria-hidden="true">↗</span>
          <h3>Selecione uma fonte</h3>
          <p>O painel se expande para mostrar metadados seguros e, quando permitido, o documento normalizado.</p>
        </div>
      </section>
    </aside>
  </main>

  <button id="mobile-source-trigger" class="mobile-source-trigger" type="button" data-open-sources>
    Abrir fontes
  </button>
  <div id="source-backdrop" class="source-backdrop" hidden></div>
  <div id="a11y-status" class="sr-only" role="status" aria-live="polite"></div>
</body>
</html>`;
}
