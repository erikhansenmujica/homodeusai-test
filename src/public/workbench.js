(function () {
  "use strict";

  var STORAGE_KEY = "nexo-atlantico-decision-history-v2";
  var MAX_HISTORY = 24;
  var profiles = [];
  var documents = [];
  var corpusTotals = { documents: 0, deliveries: 0 };
  var entries = [];
  var activeDecisionId = null;
  var currentThreadId = makeId("thread");
  var pending = false;
  var lastSubmission = null;
  var selectedSource = null;
  var sourceReturnFocus = null;
  var progressTimer = null;
  var slowTimer = null;

  var REASON_LABELS = {
    missing_source: "Fonte autoritativa ausente",
    conflicting_source: "Fontes elegíveis em conflito",
    profile_mismatch: "Contexto do solicitante incompatível",
    policy_sensitive_source: "Fonte com acesso restrito",
    validation_pending: "Validação pendente",
    human_requested: "Atendimento humano solicitado",
    provider_failure: "Serviço de decisão indisponível",
    low_confidence: "Evidência insuficiente",
    sensitive_topic: "Fluxo protegido necessário"
  };

  var QUEUE_LABELS = {
    knowledge_governance: "Governança de conhecimento",
    people_ops_triage: "Triagem de People Operations",
    people_data: "People Data",
    people_ops_lead: "Liderança de People Operations"
  };

  var DOMAIN_LABELS = {
    admission: "Admissão",
    collective_rules: "Regras coletivas",
    compensation: "Remuneração",
    corporate_governance: "Governança corporativa",
    employment: "Relação de trabalho",
    health_safety: "Saúde e segurança",
    identity_access: "Identidade e acessos",
    leave: "Ausências e afastamentos",
    payroll: "Folha e pagamentos",
    people_operations: "People Operations",
    personal_data: "Dados pessoais",
    termination: "Encerramento",
    timekeeping: "Jornada",
    vacation: "Descanso programado"
  };

  var APPROVAL_LABELS = {
    approved: "Aprovada",
    pending: "Pendente",
    rejected: "Rejeitada"
  };

  var AUDIENCE_LABELS = {
    employee: "Público colaborador",
    internal: "Uso interno",
    restricted: "Acesso restrito"
  };

  var TYPE_LABELS = {
    checklist: "Checklist",
    collective_agreement: "Instrumento coletivo",
    faq: "Central de dúvidas",
    onboarding_deck: "Apresentação",
    policy: "Política",
    process: "Processo",
    reference: "Referência",
    salary_table: "Tabela de referência",
    systems_matrix: "Matriz de sistemas"
  };

  var REJECTION_LABELS = {
    approval: "aprovação",
    audience: "audiência",
    sensitivity: "sensibilidade",
    future: "vigência futura",
    expired: "vigência encerrada",
    scope: "escopo do perfil",
    superseded: "versão substituída"
  };

  var RELATIONSHIP_LABELS = {
    employee: "Empregado",
    apprentice: "Aprendiz",
    intern: "Estagiário",
    contractor: "Prestador",
    candidate: "Candidato"
  };

  var NEXT_ACTION_LABELS = {
    human_requested: "People Operations deve contatar o solicitante e continuar a partir do pedido registrado.",
    low_confidence: "People Operations deve validar as fontes aplicáveis e registrar o próximo passo sustentado.",
    conflicting_source: "A Governança de Conhecimento deve conciliar os registros conflitantes antes de liberar uma orientação.",
    missing_source: "A Governança de Conhecimento deve localizar ou solicitar o registro autoritativo ausente.",
    profile_mismatch: "People Operations deve verificar o contexto confiável do solicitante antes de continuar.",
    sensitive_topic: "People Data deve mover o pedido para o fluxo protegido e contatar o solicitante por esse canal.",
    validation_pending: "A Governança de Conhecimento deve concluir a validação da fonte e comunicar o resultado.",
    policy_sensitive_source: "A liderança de People Operations deve avaliar se a fonte pode apoiar uma orientação ao solicitante.",
    provider_failure: "People Operations deve continuar manualmente enquanto a plataforma recupera o serviço."
  };

  var GAP_LABELS = {
    human_requested: "O solicitante pediu explicitamente a continuidade por uma pessoa.",
    low_confidence: "Não foi possível estabelecer suporte elegível suficiente para uma resposta autônoma.",
    conflicting_source: "Registros elegíveis divergem em um limite material da decisão.",
    missing_source: "O acervo fornecido não contém a autoridade necessária para responder.",
    profile_mismatch: "O contexto confiável do solicitante não corresponde ao escopo da fonte.",
    sensitive_topic: "O pedido exige um fluxo humano protegido.",
    validation_pending: "Uma fonte material ainda não concluiu a validação de governança.",
    policy_sensitive_source: "A fonte disponível exige revisão do responsável antes do uso voltado ao solicitante.",
    provider_failure: "O provedor opcional não retornou um resultado utilizável."
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function node(tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined && value !== null) element.textContent = String(value);
    return element;
  }

  function appendTextPair(parent, term, description) {
    var wrapper = node("div");
    wrapper.append(node("dt", "", term), node("dd", "", description));
    parent.appendChild(wrapper);
  }

  function makeButton(label, className, testId) {
    var element = node("button", className, label);
    element.type = "button";
    if (testId) element.setAttribute("data-testid", testId);
    return element;
  }

  function makeId(prefix) {
    var suffix = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(16).slice(2);
    return prefix + "-" + suffix;
  }

  function formatDate(value, withTime) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("pt-BR", withTime
        ? { dateStyle: "medium", timeStyle: "short" }
        : { dateStyle: "medium" }).format(new Date(value));
    } catch (_error) {
      return String(value);
    }
  }

  function formatClock(value) {
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    } catch (_error) {
      return "—";
    }
  }

  function humanize(value) {
    return String(value || "—").replace(/_/g, " ").replace(/\b\w/g, function (letter) {
      return letter.toLocaleUpperCase("pt-BR");
    });
  }

  function profileLabel(profile) {
    var role = {
      colaborador: "Colaborador",
      lider: "Liderança",
      people_ops: "People Operations",
      privacy: "Privacidade",
      candidato: "Candidato",
      gestor_contrato: "Gestão de contrato"
    }[profile.role] || humanize(profile.role);
    return role + " · " + humanize(profile.baseId);
  }

  function safeRequest(path, options) {
    return fetch(path, options).then(function (response) {
      return response.text().then(function (raw) {
        var payload = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch (_error) {
          throw new Error("invalid_response");
        }
        if (!response.ok) throw new Error("request_failed");
        return payload;
      });
    });
  }

  function selectedProfile() {
    var profileId = byId("profile-select").value;
    return profiles.find(function (profile) {
      return profile.profileId === profileId;
    }) || profiles[0];
  }

  function selectedAsOf() {
    var value = byId("effective-date").value;
    return value ? new Date(value + "T12:00:00.000Z").toISOString() : new Date().toISOString();
  }

  function profileSnapshot(profile) {
    return {
      profileId: profile.profileId,
      legalEntityId: profile.legalEntityId,
      baseId: profile.baseId,
      relationship: profile.relationship,
      role: profile.role
    };
  }

  function renderProfile() {
    var profile = selectedProfile();
    var metadata = byId("profile-meta");
    clear(metadata);
    if (!profile) return;
    appendTextPair(metadata, "Entidade", profile.legalEntityId);
    appendTextPair(metadata, "Base", profile.baseId);
    appendTextPair(metadata, "Relação", RELATIONSHIP_LABELS[profile.relationship] || humanize(profile.relationship));
    appendTextPair(metadata, "Função", humanize(profile.role));
    appendTextPair(metadata, "Efetiva em", formatDate(selectedAsOf(), false));
  }

  function renderProfiles(payload) {
    profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    var select = byId("profile-select");
    clear(select);
    profiles.forEach(function (profile) {
      var option = node("option", "", profileLabel(profile));
      option.value = profile.profileId;
      select.appendChild(option);
    });
    var routeProfileId = new URLSearchParams(window.location.search).get("profileId");
    var preferred = profiles.find(function (profile) {
      return profile.profileId === routeProfileId;
    }) || profiles.find(function (profile) {
      return profile.profileId === "employee-na-servicos-sudeste";
    }) || profiles[0];
    if (preferred) select.value = preferred.profileId;
    var date = byId("effective-date");
    if (!date.value) {
      var routeAsOf = new URLSearchParams(window.location.search).get("asOf");
      date.value = routeAsOf && !Number.isNaN(Date.parse(routeAsOf))
        ? new Date(routeAsOf).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    }
    renderEffectiveDate();
    renderProfile();
  }

  function renderEffectiveDate() {
    var label = byId("as-of-label");
    label.textContent = formatDate(selectedAsOf(), false);
  }

  function startNewThread(message, prefill) {
    currentThreadId = makeId("thread");
    activeDecisionId = null;
    selectedSource = null;
    closeSourcePanel(false);
    byId("hero").hidden = false;
    byId("request-form").hidden = false;
    byId("submitted-question").hidden = true;
    byId("examples").hidden = false;
    byId("progress-state").hidden = true;
    hideError();
    var input = byId("question-input");
    input.value = prefill || "";
    renderTimeline();
    renderHistory();
    if (message) {
      var notice = byId("context-notice");
      notice.textContent = message;
      notice.hidden = false;
    }
    window.setTimeout(function () {
      input.focus();
    }, 0);
  }

  function changeTrustedContext() {
    renderEffectiveDate();
    renderProfile();
    startNewThread(
      "O contexto confiável mudou. Uma nova linha de decisão foi iniciada; perguntas anteriores não serão reutilizadas."
    );
  }

  function persistEntries() {
    try {
      var safeEntries = entries.slice(0, MAX_HISTORY).map(function (entry) {
        return {
          id: entry.id,
          requestId: entry.requestId,
          threadId: entry.threadId,
          parentId: entry.parentId || null,
          question: entry.question,
          submittedAt: entry.submittedAt,
          asOf: entry.asOf,
          profile: entry.profile,
          decision: entry.decision,
          trace: entry.trace || null,
          traceExpanded: Boolean(entry.traceExpanded),
          handoffRecord: entry.handoffRecord || null,
          handoffOpen: Boolean(entry.handoffOpen),
          selectedSource: entry.selectedSource || null
        };
      });
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        schemaVersion: 2,
        entries: safeEntries
      }));
    } catch (_error) {
      byId("a11y-status").textContent = "O histórico continuará disponível nesta página, mas não pôde ser salvo nesta sessão.";
    }
  }

  function loadEntries() {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 2 || !Array.isArray(parsed.entries)) return;
      entries = parsed.entries.filter(function (entry) {
        return entry
          && typeof entry.id === "string"
          && typeof entry.threadId === "string"
          && typeof entry.question === "string"
          && entry.profile
          && entry.decision;
      }).slice(0, MAX_HISTORY);
    } catch (_error) {
      entries = [];
    }
  }

  function updateEntry(entry) {
    var index = entries.findIndex(function (candidate) {
      return candidate.id === entry.id;
    });
    if (index >= 0) entries[index] = entry;
    else entries.unshift(entry);
    entries = entries.slice(0, MAX_HISTORY);
    persistEntries();
  }

  function activeEntry() {
    return entries.find(function (entry) {
      return entry.id === activeDecisionId;
    }) || null;
  }

  function visibleAssistantText(decision) {
    if (!decision) return "";
    if (decision.kind === "answer" || decision.kind === "conversational") return decision.body || "";
    if (decision.kind === "defer") return decision.userMessage || "";
    return "";
  }

  function contextualHistory() {
    return entries
      .filter(function (entry) {
        return entry.threadId === currentThreadId
          && ["answer", "defer", "conversational"].includes(entry.decision.kind);
      })
      .sort(function (left, right) {
        return left.submittedAt.localeCompare(right.submittedAt);
      })
      .slice(-2)
      .flatMap(function (entry) {
        var assistant = visibleAssistantText(entry.decision);
        return assistant
          ? [
              { role: "user", content: entry.question },
              { role: "assistant", content: assistant }
            ]
          : [{ role: "user", content: entry.question }];
      });
  }

  function requesterFor(profile) {
    return {
      subjectId: "trusted-session-" + profile.profileId,
      legalEntityId: profile.legalEntityId,
      baseId: profile.baseId,
      relationship: profile.relationship,
      role: profile.role,
      domains: []
    };
  }

  function setComposerCollapsed(question) {
    byId("hero").hidden = true;
    byId("request-form").hidden = true;
    byId("examples").hidden = true;
    byId("submitted-question").hidden = false;
    byId("submitted-question-text").textContent = question;
  }

  function setBusy(isBusy, sourceButton) {
    pending = isBusy;
    var submit = byId("submit-decision");
    submit.disabled = isBusy;
    submit.setAttribute("aria-busy", isBusy ? "true" : "false");
    byId("request-form").setAttribute("aria-busy", isBusy ? "true" : "false");
    if (sourceButton && sourceButton !== submit) {
      sourceButton.disabled = isBusy;
      sourceButton.setAttribute("aria-busy", isBusy ? "true" : "false");
    }
  }

  function startProgress(question) {
    setComposerCollapsed(question);
    byId("progress-state").hidden = false;
    byId("slow-message").hidden = true;
    var stages = Array.from(byId("progress-stages").children);
    var stageIndex = 0;
    stages.forEach(function (stage, index) {
      stage.classList.toggle("is-active", index === 0);
    });
    window.clearInterval(progressTimer);
    window.clearTimeout(slowTimer);
    progressTimer = window.setInterval(function () {
      stageIndex = Math.min(stageIndex + 1, stages.length - 1);
      stages.forEach(function (stage, index) {
        stage.classList.toggle("is-active", index === stageIndex);
      });
    }, 1350);
    slowTimer = window.setTimeout(function () {
      byId("slow-message").hidden = false;
    }, 4500);
  }

  function stopProgress() {
    window.clearInterval(progressTimer);
    window.clearTimeout(slowTimer);
    byId("progress-state").hidden = true;
  }

  function hideError() {
    var target = byId("error-state");
    target.hidden = true;
    clear(target);
  }

  function showError(retry) {
    var target = byId("error-state");
    clear(target);
    target.hidden = false;
    target.append(
      node("h2", "", "Não foi possível concluir a análise"),
      node("p", "", "A consulta foi preservada. Verifique a conexão e tente novamente; nenhum diagnóstico interno foi exibido.")
    );
    var retryButton = makeButton("Tentar novamente", "secondary-button");
    retryButton.addEventListener("click", retry);
    target.appendChild(retryButton);
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function makeFailureDecision() {
    return {
      kind: "error",
      userMessage: "A análise não foi concluída por uma falha de transporte."
    };
  }

  function submitDecision(question, followup, sourceButton) {
    if (pending) return;
    var profile = selectedProfile();
    if (!profile) {
      showError(function () {
        window.location.reload();
      });
      return;
    }

    var cleanQuestion = String(question || "").trim();
    if (!cleanQuestion) return;
    var requestId = makeId("desk");
    var asOf = selectedAsOf();
    var history = followup ? contextualHistory() : [];
    var parent = followup ? activeEntry() : null;
    lastSubmission = {
      question: cleanQuestion,
      followup: Boolean(followup)
    };
    hideError();
    startProgress(cleanQuestion);
    setBusy(true, sourceButton);

    safeRequest("/v1/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: requestId,
        question: cleanQuestion,
        asOf: asOf,
        requester: requesterFor(profile),
        history: history
      })
    }).then(function (decision) {
      var entry = {
        id: requestId,
        requestId: requestId,
        threadId: currentThreadId,
        parentId: parent ? parent.id : null,
        question: cleanQuestion,
        submittedAt: new Date().toISOString(),
        asOf: asOf,
        profile: profileSnapshot(profile),
        decision: decision,
        trace: null,
        traceExpanded: false,
        handoffRecord: null,
        handoffOpen: false,
        selectedSource: null
      };
      activeDecisionId = entry.id;
      updateEntry(entry);
      renderTimeline();
      renderHistory();
      byId("a11y-status").textContent = decision.kind === "answer"
        ? "Nova resposta sustentada disponível."
        : decision.kind === "defer"
          ? "Novo encaminhamento humano disponível."
          : "Nova resposta conversacional disponível.";
      if (decision.kind === "defer") hydrateTrace(entry, false);
    }).catch(function () {
      var failedEntry = {
        id: requestId,
        requestId: requestId,
        threadId: currentThreadId,
        parentId: parent ? parent.id : null,
        question: cleanQuestion,
        submittedAt: new Date().toISOString(),
        asOf: asOf,
        profile: profileSnapshot(profile),
        decision: makeFailureDecision(),
        trace: null,
        traceExpanded: false,
        handoffRecord: null,
        handoffOpen: false,
        selectedSource: null
      };
      activeDecisionId = failedEntry.id;
      updateEntry(failedEntry);
      renderTimeline();
      renderHistory();
      showError(function () {
        submitDecision(lastSubmission.question, lastSubmission.followup, byId("submit-decision"));
      });
    }).finally(function () {
      stopProgress();
      setBusy(false, sourceButton);
      renderTimeline();
    });
  }

  function outcomeLabel(entry) {
    var decision = entry.decision;
    if (decision.kind === "answer") return "Sustentada";
    if (decision.kind === "conversational") return "Conversacional";
    if (decision.kind === "error") return "Falha";
    var status = entry.handoffRecord && entry.handoffRecord.status === "resolved" ? "resolvida" : "aberta";
    return "Encaminhada · " + status;
  }

  function renderHistory() {
    var list = byId("history-list");
    clear(list);
    byId("history-count").textContent = entries.length + (entries.length === 1 ? " registro" : " registros");
    if (!entries.length) {
      list.appendChild(node("p", "history-empty", "Nenhuma decisão recente."));
      return;
    }
    entries.forEach(function (entry) {
      var item = makeButton("", "history-row");
      item.setAttribute("aria-current", entry.id === activeDecisionId ? "true" : "false");
      item.setAttribute("aria-label", "Restaurar decisão: " + entry.question);
      item.appendChild(node("time", "", formatClock(entry.submittedAt)));
      var copy = node("span", "history-copy");
      copy.append(
        node("strong", "", entry.question),
        node("span", "", entry.profile.legalEntityId + " · " + entry.profile.baseId + " · " + formatDate(entry.asOf, false))
      );
      item.appendChild(copy);
      var meta = node("span", "history-meta");
      var badge = node("span", "outcome-badge", outcomeLabel(entry));
      badge.setAttribute("data-kind", entry.decision.kind);
      meta.appendChild(badge);
      if (typeof entry.decision.answerabilityScore === "number") {
        meta.appendChild(node("span", "outcome-badge", Math.round(entry.decision.answerabilityScore * 100) + "%"));
      }
      if (entry.decision.traceId) meta.appendChild(node("span", "outcome-badge", "trilha"));
      item.appendChild(meta);
      item.addEventListener("click", function () {
        restoreEntry(entry.id);
      });
      list.appendChild(item);
    });
  }

  function restoreEntry(entryId) {
    var entry = entries.find(function (candidate) {
      return candidate.id === entryId;
    });
    if (!entry) return;
    activeDecisionId = entry.id;
    currentThreadId = entry.threadId;
    var knownProfile = profiles.find(function (profile) {
      return profile.profileId === entry.profile.profileId;
    });
    if (knownProfile) byId("profile-select").value = knownProfile.profileId;
    byId("effective-date").value = new Date(entry.asOf).toISOString().slice(0, 10);
    renderEffectiveDate();
    renderProfile();
    byId("context-notice").hidden = true;
    setComposerCollapsed(entry.question);
    hideError();
    renderTimeline();
    renderHistory();
    if (entry.decision.kind === "error") {
      showError(function () {
        submitDecision(entry.question, Boolean(entry.parentId), byId("submit-decision"));
      });
    }
    if (entry.selectedSource) {
      showSource(
        entry.selectedSource.sourceId,
        entry.selectedSource.versionId,
        entry.selectedSource,
        false,
        null
      );
    }
    byId("decision-result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function threadEntries() {
    return entries
      .filter(function (entry) {
        return entry.threadId === currentThreadId;
      })
      .sort(function (left, right) {
        return left.submittedAt.localeCompare(right.submittedAt);
      });
  }

  function appendContextChips(card, entry) {
    var context = node("div", "decision-context");
    [
      entry.profile.legalEntityId,
      entry.profile.baseId,
      RELATIONSHIP_LABELS[entry.profile.relationship] || humanize(entry.profile.relationship),
      humanize(entry.profile.role),
      formatDate(entry.asOf, false)
    ].forEach(function (value) {
      context.appendChild(node("span", "context-chip", value));
    });
    card.appendChild(context);
  }

  function resultHeading(card, kind, title, score) {
    var outcome = node("div", "decision-outcome");
    var copy = node("div");
    var labels = {
      answer: "Resposta sustentada",
      defer: "Encaminhamento humano",
      conversational: "Resposta conversacional",
      error: "Falha na análise"
    };
    var label = node("p", "decision-label", labels[kind] || kind);
    label.setAttribute("data-kind", kind);
    copy.append(label, node("h3", "", title));
    outcome.appendChild(copy);
    if (typeof score === "number") {
      var scoreBlock = node("div", "score-block");
      scoreBlock.append(
        node("span", "", "Indicador de sustentação"),
        node("strong", "", Math.round(score * 100) + "%")
      );
      var meter = node("meter");
      meter.min = 0;
      meter.max = 1;
      meter.value = score;
      meter.setAttribute("aria-label", "Indicador de sustentação");
      scoreBlock.appendChild(meter);
      outcome.appendChild(scoreBlock);
    }
    card.appendChild(outcome);
  }

  function documentFor(sourceId, versionId) {
    return documents.find(function (document) {
      return document.sourceId === sourceId
        && (!versionId || document.versionId === versionId);
    });
  }

  function sourceContextParams() {
    var profile = selectedProfile();
    var params = new URLSearchParams();
    if (profile) {
      params.set("profileId", profile.profileId);
      params.set("legalEntityId", profile.legalEntityId);
      params.set("baseId", profile.baseId);
      params.set("relationship", profile.relationship);
      params.set("role", profile.role);
    }
    params.set("asOf", selectedAsOf());
    return params;
  }

  function sourceHref(sourceId, versionId, span) {
    var params = sourceContextParams();
    if (span && Number.isInteger(span.startByte)) params.set("startByte", String(span.startByte));
    if (span && Number.isInteger(span.endByte)) params.set("endByte", String(span.endByte));
    var active = activeEntry();
    if (active) params.set("decisionId", active.id);
    return "/sources/" + encodeURIComponent(sourceId) + "/" + encodeURIComponent(versionId) + "?" + params.toString();
  }

  function attachSourceNavigation(anchor, sourceId, versionId, span) {
    anchor.addEventListener("click", function (event) {
      if (
        event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return;
      event.preventDefault();
      showSource(sourceId, versionId, span || null, true, anchor);
    });
  }

  function makeSourceAnchor(documentMetadata, label, span, testId) {
    var anchor = node("a", "source-link", label);
    anchor.href = sourceHref(documentMetadata.sourceId, documentMetadata.versionId, span);
    if (testId) anchor.setAttribute("data-testid", testId);
    attachSourceNavigation(anchor, documentMetadata.sourceId, documentMetadata.versionId, span);
    return anchor;
  }

  function renderAnswer(card, entry, active) {
    var decision = entry.decision;
    resultHeading(card, "answer", "Orientação apoiada por evidência elegível", decision.answerabilityScore);
    var copy = node("div", "decision-copy");
    copy.appendChild(node("p", "", decision.body));
    card.appendChild(copy);
    var panel = node("section", "claims-panel");
    if (active) panel.setAttribute("data-testid", "claims-panel");
    panel.appendChild(node("h4", "section-title", "Afirmações e evidências"));
    (decision.claims || []).forEach(function (claim, claimIndex) {
      var claimCard = node("article", "claim");
      claimCard.appendChild(node("strong", "", claim.text));
      (claim.evidence || []).forEach(function (evidence) {
        var metadata = documentFor(evidence.sourceId, evidence.versionId) || {
          sourceId: evidence.sourceId,
          versionId: evidence.versionId,
          title: evidence.sourceId,
          domain: "—",
          approval: "approved",
          audience: "employee",
          authorityTier: "—",
          effectiveFrom: "—"
        };
        var block = node("div", "evidence-block");
        block.appendChild(node("span", "evidence-source-title", metadata.title));
        var badges = node("div", "evidence-meta");
        [
          "Versão " + evidence.versionId,
          APPROVAL_LABELS[metadata.approval] || humanize(metadata.approval),
          AUDIENCE_LABELS[metadata.audience] || humanize(metadata.audience),
          "Autoridade " + metadata.authorityTier
        ].forEach(function (value) {
          badges.appendChild(node("span", "governance-badge", value));
        });
        block.appendChild(badges);
        block.appendChild(node("blockquote", "", evidence.quote));
        var span = {
          sourceId: evidence.sourceId,
          versionId: evidence.versionId,
          startByte: evidence.startByte,
          endByte: evidence.endByte,
          quote: evidence.quote,
          claimId: claim.id || "claim-" + claimIndex
        };
        block.appendChild(makeSourceAnchor(metadata, "Abrir documento", span, active ? "evidence-source-link" : null));
        claimCard.appendChild(block);
      });
      panel.appendChild(claimCard);
    });
    card.appendChild(panel);
  }

  function receiptItem(label, value) {
    var item = node("div", "receipt-item");
    item.append(node("span", "", label), node("strong", "", value));
    return item;
  }

  function recommendationDocumentIds(entry) {
    var trace = entry.trace;
    if (!trace) return [];
    var reason = entry.decision.handoff.reasonCode;
    var ids = [];
    if (reason === "conflicting_source" && Array.isArray(trace.conflicts)) {
      trace.conflicts.forEach(function (conflict) {
        (conflict.sourceIds || []).forEach(function (sourceId) {
          ids.push(sourceId);
        });
      });
    }
    if (!ids.length && reason === "conflicting_source") {
      (trace.governance && trace.governance.eligibleSources || []).forEach(function (source) {
        ids.push(source.sourceId);
      });
    }
    if (!ids.length) {
      (trace.consideredEvidence || []).forEach(function (evidence) {
        if (
          reason === "validation_pending" && (evidence.rejectionCodes || []).includes("approval")
          || reason === "profile_mismatch" && (evidence.rejectionCodes || []).includes("scope")
          || ["policy_sensitive_source", "sensitive_topic"].includes(reason)
            && (evidence.rejectionCodes || []).some(function (code) {
              return code === "audience" || code === "sensitivity";
            })
          || reason === "missing_source"
        ) {
          ids.push(evidence.sourceId);
        }
      });
    }
    return Array.from(new Set(ids));
  }

  function filteredCorpusHref(filterName, filterValue) {
    var params = sourceContextParams();
    if (filterName && filterValue) params.set(filterName, filterValue);
    return "/sources?" + params.toString();
  }

  function renderRecommendations(panel, entry) {
    var decision = entry.decision;
    var reason = decision.handoff.reasonCode;
    var section = node("section", "recommendations");
    section.appendChild(node("h4", "section-title", "Onde verificar"));
    var explanation = {
      conflicting_source: "As fontes elegíveis precisam ser conciliadas por uma pessoa; nenhuma delas foi escolhida silenciosamente.",
      missing_source: "Consulte o inventário do domínio relacionado. O acervo não contém a autoridade necessária para responder.",
      validation_pending: "A fonte relevante ainda aguarda validação e não pode sustentar uma orientação.",
      profile_mismatch: "A fonte encontrada não cobre algum eixo do contexto confiável desta decisão.",
      policy_sensitive_source: "O conteúdo deve ser revisto por um operador autorizado.",
      sensitive_topic: "O caso precisa seguir por um canal protegido.",
      provider_failure: "A triagem pode continuar manualmente enquanto o serviço é recuperado.",
      human_requested: "A fila responsável continuará a partir do pedido e do contexto preservados.",
      low_confidence: "People Operations deve validar as fontes aplicáveis antes de orientar."
    };
    section.appendChild(node("p", "", explanation[reason] || "A fila responsável deve revisar a decisão."));
    var list = node("div", "recommendation-list");
    var sourceIds = recommendationDocumentIds(entry);
    sourceIds.slice(0, reason === "conflicting_source" ? 6 : 3).forEach(function (sourceId) {
      var metadata = documentFor(sourceId);
      if (!metadata) return;
      var item = node("div", "recommendation-item");
      item.append(
        node("strong", "", metadata.title),
        node("span", "", (DOMAIN_LABELS[metadata.domain] || humanize(metadata.domain))
          + " · versão " + metadata.versionId
          + " · " + (APPROVAL_LABELS[metadata.approval] || humanize(metadata.approval)))
      );
      item.appendChild(makeSourceAnchor(metadata, "Ver metadados governados", null, null));
      list.appendChild(item);
    });

    if (reason === "missing_source") {
      var related = sourceIds.map(function (sourceId) {
        return documentFor(sourceId);
      }).find(Boolean);
      var inventoryItem = node("div", "recommendation-item");
      inventoryItem.append(
        node("strong", "", related
          ? "Inventário de " + (DOMAIN_LABELS[related.domain] || humanize(related.domain))
          : "Inventário governado"),
        node("span", "", "Nenhum documento específico é presumido como existente.")
      );
      var corpusLink = node("a", "source-link", "Ver fontes disponíveis");
      corpusLink.href = related
        ? filteredCorpusHref("domain", related.domain)
        : filteredCorpusHref("", "");
      corpusLink.addEventListener("click", function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (related) byId("filter-domain").value = related.domain;
        renderSourceList();
        openSourcePanel(corpusLink, true);
        replaceCorpusRoute();
      });
      inventoryItem.appendChild(corpusLink);
      list.appendChild(inventoryItem);
    }

    var owner = node("div", "recommendation-item");
    owner.append(
      node("strong", "", QUEUE_LABELS[decision.handoff.queue] || humanize(decision.handoff.queue)),
      node("span", "", "Próxima ação: abrir o caso preservado e continuar na fila responsável.")
    );
    list.appendChild(owner);
    section.appendChild(list);
    panel.appendChild(section);
  }

  function renderDefer(card, entry, active) {
    var decision = entry.decision;
    resultHeading(card, "defer", REASON_LABELS[decision.handoff.reasonCode] || humanize(decision.handoff.reasonCode), decision.answerabilityScore);
    var copy = node("div", "decision-copy");
    copy.appendChild(node("p", "", decision.userMessage));
    card.appendChild(copy);
    var panel = node("section", "handoff-panel");
    if (active) panel.setAttribute("data-testid", "handoff-panel");
    panel.appendChild(node("h4", "section-title", "Encaminhamento operacional"));
    var receipt = node("div", "handoff-receipt");
    var status = entry.handoffRecord ? entry.handoffRecord.status : "open";
    receipt.append(
      receiptItem("Ticket", decision.handoff.ticketId),
      receiptItem("Situação", status === "resolved" ? "Resolvido" : "Aberto"),
      receiptItem("Motivo", REASON_LABELS[decision.handoff.reasonCode] || humanize(decision.handoff.reasonCode)),
      receiptItem("Responsável", QUEUE_LABELS[decision.handoff.queue] || humanize(decision.handoff.queue)),
      receiptItem("Fila", decision.handoff.queue),
      receiptItem("SLA", decision.handoff.slaHours + " horas")
    );
    panel.appendChild(receipt);
    var actions = node("div", "handoff-actions");
    var openButton = makeButton(
      entry.handoffOpen ? "Recarregar caso" : "Abrir caso",
      "secondary-button",
      active ? "handoff-open" : null
    );
    openButton.addEventListener("click", function () {
      openHandoff(entry);
    });
    actions.appendChild(openButton);
    panel.appendChild(actions);
    renderRecommendations(panel, entry);
    if (entry.handoffOpen && entry.handoffRecord) {
      panel.appendChild(renderHandoffRecord(entry, active));
    }
    card.appendChild(panel);
  }

  function recordField(grid, label, value) {
    appendTextPair(grid, label, value == null ? "—" : value);
  }

  function renderHandoffRecord(entry, active) {
    var record = entry.handoffRecord;
    var panel = node("section", "record");
    if (active) panel.setAttribute("data-testid", "handoff-record");
    panel.id = active ? "handoff-record" : "";
    panel.tabIndex = -1;
    var head = node("div", "record-head");
    head.append(
      node("h3", "", "Caso " + record.ticketId),
      node("span", "status-chip", record.status === "resolved" ? "Resolvido" : "Aberto")
    );
    panel.appendChild(head);
    var grid = node("dl", "record-grid");
    recordField(grid, "Responsável", QUEUE_LABELS[record.queue] || humanize(record.queue));
    recordField(grid, "Fila", record.queue);
    recordField(grid, "SLA", record.slaHours + " horas");
    recordField(grid, "Criado", formatDate(record.createdAt, true));
    recordField(grid, "Atualizado", formatDate(record.updatedAt, true));
    recordField(grid, "Data efetiva", formatDate(record.request && record.request.asOf, false));
    recordField(grid, "Entidade", record.request && record.request.requester && record.request.requester.legalEntityId);
    recordField(grid, "Base", record.request && record.request.requester && record.request.requester.baseId);
    recordField(
      grid,
      "Relação",
      record.request
        && record.request.requester
        && (RELATIONSHIP_LABELS[record.request.requester.relationship] || humanize(record.request.requester.relationship))
    );
    recordField(grid, "Função", record.request && record.request.requester && humanize(record.request.requester.role));
    recordField(grid, "Próxima ação", NEXT_ACTION_LABELS[record.reasonCode] || record.nextAction);
    panel.appendChild(grid);
    panel.append(
      node("h4", "section-title", "Pedido original"),
      node("div", "record-question", record.request && record.request.question)
    );
    panel.appendChild(node("h4", "section-title", "Lacunas de evidência"));
    var gaps = node("ul", "gap-list");
    var readableGaps = GAP_LABELS[record.reasonCode]
      ? [GAP_LABELS[record.reasonCode]]
      : record.evidenceGaps || [];
    readableGaps.forEach(function (gap) {
      gaps.appendChild(node("li", "", gap));
    });
    panel.appendChild(gaps);

    if (record.status === "resolved") {
      var resolved = node("section", "resolved-state");
      if (active) resolved.setAttribute("data-testid", "handoff-resolved-state");
      resolved.append(
        node("strong", "", "Resolução canônica"),
        node("p", "", record.resolution ? record.resolution.summary : "Resolução registrada."),
        node("span", "", record.resolution
          ? "Concluído por " + record.resolution.actorId + " em " + formatDate(record.resolution.resolvedAt, true)
          : "")
      );
      panel.appendChild(resolved);
      return panel;
    }

    var form = node("form", "resolution-form");
    if (active) form.setAttribute("data-testid", "handoff-resolution-form");
    var label = node("label", "", "Resumo da resolução");
    var summary = node("textarea");
    summary.id = active ? "handoff-resolution-summary" : "";
    summary.required = true;
    summary.maxLength = 4000;
    summary.placeholder = "Registre a evidência validada e o próximo passo comunicado.";
    if (active) summary.setAttribute("data-testid", "handoff-resolution-summary");
    label.htmlFor = summary.id;
    var resolveButton = makeButton("Concluir caso", "primary-button", active ? "handoff-resolve" : null);
    resolveButton.type = "submit";
    form.append(label, summary, resolveButton);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = summary.value.trim();
      if (!value || resolveButton.disabled) return;
      resolveButton.disabled = true;
      resolveButton.setAttribute("aria-busy", "true");
      safeRequest("/v1/handoffs/" + encodeURIComponent(record.ticketId) + "/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actorId: "operator-trusted-session",
          summary: value
        })
      }).then(function (updated) {
        entry.handoffRecord = updated;
        entry.handoffOpen = true;
        updateEntry(entry);
        renderTimeline();
        renderHistory();
        byId("a11y-status").textContent = "Caso resolvido e histórico atualizado.";
        var resolvedState = document.querySelector("[data-testid='handoff-resolved-state']");
        if (resolvedState) resolvedState.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }).catch(function () {
        showError(function () {
          openHandoff(entry);
        });
      }).finally(function () {
        resolveButton.disabled = false;
        resolveButton.setAttribute("aria-busy", "false");
      });
    });
    panel.appendChild(form);
    return panel;
  }

  function openHandoff(entry) {
    hideError();
    safeRequest("/v1/handoffs/" + encodeURIComponent(entry.decision.handoff.ticketId))
      .then(function (record) {
        entry.handoffRecord = record;
        entry.handoffOpen = true;
        updateEntry(entry);
        renderTimeline();
        renderHistory();
        var recordPanel = document.querySelector("[data-testid='handoff-record']");
        if (recordPanel) {
          recordPanel.focus();
          recordPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      })
      .catch(function () {
        showError(function () {
          openHandoff(entry);
        });
      });
  }

  function renderConversational(card, entry) {
    resultHeading(card, "conversational", "Continuidade sem decisão documental");
    var copy = node("div", "decision-copy");
    copy.appendChild(node("p", "", entry.decision.body));
    card.appendChild(copy);
  }

  function renderFailure(card, entry) {
    resultHeading(card, "error", "A consulta foi preservada");
    var copy = node("div", "decision-copy");
    copy.appendChild(node("p", "", entry.decision.userMessage));
    card.appendChild(copy);
  }

  function renderTracePanel(entry, active) {
    var trace = entry.trace;
    var panel = node("section", "trace-panel");
    if (active) panel.setAttribute("data-testid", "trace-panel");
    panel.tabIndex = -1;
    panel.appendChild(node("h3", "", "Trilha de decisão"));
    if (!trace) {
      panel.appendChild(node("p", "history-empty", "Carregando diagnóstico seguro…"));
      return panel;
    }
    var grid = node("dl", "trace-grid");
    recordField(grid, "Recuperação", "Concluída");
    recordField(grid, "Candidatas", trace.governance && trace.governance.candidateCount);
    recordField(grid, "Elegíveis", trace.governance && trace.governance.eligibleCount);
    recordField(grid, "Rejeitadas", trace.governance && trace.governance.rejectedCount);
    recordField(grid, "Rota", trace.route && (trace.route.kind + (trace.route.reasonCode ? " · " + (REASON_LABELS[trace.route.reasonCode] || trace.route.reasonCode) : "")));
    recordField(grid, "Provider", trace.provider && humanize(trace.provider.status));
    panel.appendChild(grid);
    panel.appendChild(node("h4", "section-title", "Etapas registradas"));
    var stages = node("ol", "trace-list");
    var stageLabels = {
      retrieval: "Recuperação de candidatas",
      governance: "Validação de governança",
      decision: "Roteamento terminal"
    };
    (trace.stages || []).forEach(function (stage) {
      stages.appendChild(node("li", "", stageLabels[stage] || humanize(stage)));
    });
    panel.appendChild(stages);

    var eligibleSources = trace.governance && trace.governance.eligibleSources || [];
    if (eligibleSources.length) {
      panel.appendChild(node("h4", "section-title", "Fontes elegíveis"));
      var sources = node("ul", "trace-source-list");
      eligibleSources.forEach(function (source) {
        var metadata = documentFor(source.sourceId, source.versionId);
        var item = node("li");
        item.appendChild(metadata
          ? makeSourceAnchor(metadata, metadata.title + " · " + metadata.versionId, null, null)
          : node("span", "", source.sourceId + " · " + source.versionId));
        sources.appendChild(item);
      });
      panel.appendChild(sources);
    }
    var rejectionEntries = Object.entries(trace.governance && trace.governance.rejectionReasons || {});
    if (rejectionEntries.length) {
      panel.appendChild(node("h4", "section-title", "Motivos de rejeição"));
      var rejectionList = node("ul", "trace-list");
      rejectionEntries.forEach(function (pair) {
        rejectionList.appendChild(node("li", "", (REJECTION_LABELS[pair[0]] || humanize(pair[0])) + ": " + pair[1]));
      });
      panel.appendChild(rejectionList);
    }
    return panel;
  }

  function hydrateTrace(entry, expand) {
    if (!entry.decision.traceId) return Promise.resolve();
    if (expand) {
      entry.traceExpanded = true;
      renderTimeline();
    }
    if (entry.trace) {
      updateEntry(entry);
      renderTimeline();
      return Promise.resolve(entry.trace);
    }
    return safeRequest("/v1/traces/" + encodeURIComponent(entry.decision.traceId))
      .then(function (trace) {
        entry.trace = trace;
        if (expand) entry.traceExpanded = true;
        updateEntry(entry);
        renderTimeline();
        if (expand) {
          var tracePanel = document.querySelector("[data-testid='trace-panel']");
          if (tracePanel) {
            tracePanel.focus();
            tracePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
        return trace;
      })
      .catch(function () {
        if (expand) showError(function () {
          hydrateTrace(entry, true);
        });
      });
  }

  function addDecisionTools(card, entry, active) {
    if (!entry.decision.traceId) return;
    var tools = node("div", "decision-tools");
    var traceButton = makeButton(
      entry.traceExpanded ? "Ocultar trilha" : "Ver trilha da decisão",
      "secondary-button",
      active ? "trace-trigger" : null
    );
    traceButton.addEventListener("click", function () {
      if (entry.traceExpanded) {
        entry.traceExpanded = false;
        updateEntry(entry);
        renderTimeline();
      } else {
        hydrateTrace(entry, true);
      }
    });
    tools.appendChild(traceButton);
    card.appendChild(tools);
    if (entry.traceExpanded) card.appendChild(renderTracePanel(entry, active));
  }

  function renderFollowup(card) {
    var form = node("form", "followup");
    var head = node("div", "followup-head");
    head.append(
      node("h3", "", "Pergunta complementar"),
      node("span", "", "Mesmo contexto confiável e mesma data")
    );
    var label = node("label", "sr-only", "Pergunta complementar sobre esta decisão");
    var row = node("div", "followup-row");
    var input = node("textarea");
    input.required = true;
    input.maxLength = 12000;
    input.rows = 2;
    input.placeholder = "Faça uma pergunta complementar sobre esta decisão";
    var submit = makeButton("Analisar complemento", "primary-button");
    submit.type = "submit";
    row.append(input, submit);
    form.append(head, label, row);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitDecision(input.value, true, submit);
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    card.appendChild(form);
  }

  function renderDecisionCard(entry, index, active) {
    var card = node("article", "decision-card");
    card.setAttribute("data-decision-id", entry.id);
    if (active) card.setAttribute("aria-current", "true");
    var head = node("header", "decision-card-head");
    var title = node("div");
    title.append(
      node("span", "decision-sequence", "Decisão " + String(index + 1).padStart(2, "0")),
      node("h2", "", entry.question)
    );
    head.append(title, node("time", "", formatDate(entry.submittedAt, true)));
    card.appendChild(head);
    appendContextChips(card, entry);
    if (entry.decision.kind === "answer") renderAnswer(card, entry, active);
    else if (entry.decision.kind === "defer") renderDefer(card, entry, active);
    else if (entry.decision.kind === "conversational") renderConversational(card, entry);
    else renderFailure(card, entry);
    addDecisionTools(card, entry, active);
    if (active && entry.decision.kind !== "error" && !pending) renderFollowup(card);
    return card;
  }

  function renderTimeline() {
    var target = byId("decision-result");
    clear(target);
    var timelineEntries = threadEntries();
    if (!timelineEntries.length) {
      var empty = node("div", "result-empty");
      empty.append(
        node("span", "", "01"),
        node("p", "", "A próxima decisão aparecerá aqui com evidência elegível ou um encaminhamento operacional completo.")
      );
      target.appendChild(empty);
      return;
    }
    timelineEntries.forEach(function (entry, index) {
      target.appendChild(renderDecisionCard(entry, index, entry.id === activeDecisionId));
    });
  }

  function optionFor(value, label) {
    var option = node("option", "", label);
    option.value = value;
    return option;
  }

  function populateFilter(selectId, values, labels) {
    var select = byId(selectId);
    var prior = select.value;
    while (select.options.length > 1) select.remove(1);
    values.sort().forEach(function (value) {
      select.appendChild(optionFor(value, labels[value] || humanize(value)));
    });
    if (values.includes(prior)) select.value = prior;
  }

  function sourceItemBadges(documentMetadata) {
    return [
      DOMAIN_LABELS[documentMetadata.domain] || humanize(documentMetadata.domain),
      APPROVAL_LABELS[documentMetadata.approval] || humanize(documentMetadata.approval),
      AUDIENCE_LABELS[documentMetadata.audience] || humanize(documentMetadata.audience),
      "Nível " + documentMetadata.authorityTier,
      "Desde " + formatDate(documentMetadata.effectiveFrom, false)
    ];
  }

  function currentFilters() {
    return {
      search: byId("source-search").value.trim(),
      domain: byId("filter-domain").value,
      approval: byId("filter-approval").value,
      audience: byId("filter-audience").value,
      type: byId("filter-type").value
    };
  }

  function renderSourceList() {
    var filters = currentFilters();
    var needle = filters.search.toLocaleLowerCase("pt-BR");
    var visible = documents.filter(function (documentMetadata) {
      return (!needle || (documentMetadata.title + " " + documentMetadata.sourceId)
        .toLocaleLowerCase("pt-BR").includes(needle))
        && (!filters.domain || documentMetadata.domain === filters.domain)
        && (!filters.approval || documentMetadata.approval === filters.approval)
        && (!filters.audience || documentMetadata.audience === filters.audience)
        && (!filters.type || documentMetadata.sourceType === filters.type);
    });
    var list = byId("source-list");
    clear(list);
    visible.forEach(function (documentMetadata) {
      var item = node("a", "source-item");
      item.href = sourceHref(documentMetadata.sourceId, documentMetadata.versionId, null);
      item.setAttribute("data-source-id", documentMetadata.sourceId);
      item.setAttribute(
        "aria-current",
        selectedSource && selectedSource.sourceId === documentMetadata.sourceId ? "true" : "false"
      );
      item.appendChild(node("strong", "", documentMetadata.title));
      var meta = node("span", "source-item-meta");
      sourceItemBadges(documentMetadata).forEach(function (badge) {
        meta.appendChild(node("span", "", badge));
      });
      item.appendChild(meta);
      attachSourceNavigation(item, documentMetadata.sourceId, documentMetadata.versionId, null);
      list.appendChild(item);
    });
    byId("source-count").textContent = visible.length + (visible.length === 1 ? " fonte" : " fontes");
    var activeFilterCount = Object.values(filters).filter(Boolean).length;
    byId("active-filter-count").textContent = String(activeFilterCount);
    if (!visible.length) list.appendChild(node("p", "history-empty", "Nenhuma fonte corresponde aos filtros."));
  }

  function renderCorpus(payload) {
    documents = Array.isArray(payload.documents) ? payload.documents : [];
    corpusTotals = payload.totals || { documents: documents.length, deliveries: 0 };
    byId("corpus-document-count").textContent = String(corpusTotals.documents || documents.length);
    byId("corpus-delivery-count").textContent = String(corpusTotals.deliveries || 0);
    populateFilter("filter-domain", Array.from(new Set(documents.map(function (documentMetadata) {
      return documentMetadata.domain;
    }))), DOMAIN_LABELS);
    populateFilter("filter-approval", Array.from(new Set(documents.map(function (documentMetadata) {
      return documentMetadata.approval;
    }))), APPROVAL_LABELS);
    populateFilter("filter-audience", Array.from(new Set(documents.map(function (documentMetadata) {
      return documentMetadata.audience;
    }))), AUDIENCE_LABELS);
    populateFilter("filter-type", Array.from(new Set(documents.map(function (documentMetadata) {
      return documentMetadata.sourceType;
    }))), TYPE_LABELS);
    applySourceRoute();
    renderSourceList();
  }

  function sourceApiPath(sourceId, versionId) {
    var params = sourceContextParams();
    return "/api/sources/" + encodeURIComponent(sourceId) + "/" + encodeURIComponent(versionId)
      + "?" + params.toString();
  }

  function renderSourceMetadata(panel, metadata) {
    var metadataList = node("dl", "source-metadata");
    [
      ["ID da fonte", metadata.sourceId],
      ["Versão", metadata.versionId],
      ["Domínio", DOMAIN_LABELS[metadata.domain] || humanize(metadata.domain)],
      ["Tipo", TYPE_LABELS[metadata.sourceType] || humanize(metadata.sourceType)],
      ["Aprovação", APPROVAL_LABELS[metadata.approval] || humanize(metadata.approval)],
      ["Audiência", AUDIENCE_LABELS[metadata.audience] || humanize(metadata.audience)],
      ["Autoridade", "Nível " + metadata.authorityTier],
      ["Sensibilidade", humanize(metadata.policySensitivity)],
      ["Vigência", formatDate(metadata.effectiveFrom, false)
        + (metadata.effectiveTo ? " — " + formatDate(metadata.effectiveTo, false) : "")],
      ["Entidades", (metadata.eligibility && metadata.eligibility.legalEntityIds || []).join(", ")],
      ["Bases", (metadata.eligibility && metadata.eligibility.baseIds || []).join(", ")],
      ["Relações", (metadata.eligibility && metadata.eligibility.relationships || []).map(function (relationship) {
        return RELATIONSHIP_LABELS[relationship] || humanize(relationship);
      }).join(", ")],
      ["Funções", (metadata.eligibility && metadata.eligibility.roles || []).map(humanize).join(", ")],
      ["Extração", humanize(metadata.extractionMode)
        + (metadata.ocrReviewed ? " · OCR revisado" : "")],
      ["Formato original", metadata.originalFormat],
      ["Tamanho normalizado", metadata.contentBytes + " bytes"]
    ].forEach(function (pair) {
      metadataList.append(node("dt", "", pair[0]), node("dd", "", pair[1] || "—"));
    });
    panel.appendChild(metadataList);
  }

  function renderDocumentContent(panel, content, span) {
    var documentBody = node("pre", "source-document");
    if (
      span
      && Number.isInteger(span.startByte)
      && Number.isInteger(span.endByte)
      && span.startByte >= 0
      && span.endByte > span.startByte
    ) {
      var encoder = new TextEncoder();
      var decoder = new TextDecoder("utf-8", { fatal: false });
      var bytes = encoder.encode(content);
      if (span.endByte <= bytes.length) {
        var before = decoder.decode(bytes.slice(0, span.startByte));
        var exact = decoder.decode(bytes.slice(span.startByte, span.endByte));
        var after = decoder.decode(bytes.slice(span.endByte));
        documentBody.appendChild(document.createTextNode(before));
        var mark = node("mark", "", exact);
        mark.id = "evidence-highlight";
        documentBody.appendChild(mark);
        documentBody.appendChild(document.createTextNode(after));
        panel.appendChild(documentBody);
        window.setTimeout(function () {
          mark.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
        return;
      }
    }
    documentBody.textContent = content;
    panel.appendChild(documentBody);
  }

  function sourceBackHref() {
    return activeEntry() ? "/#decision-" + activeEntry().id : "/";
  }

  function renderSourceDetail(payload, span) {
    var panel = byId("source-detail");
    clear(panel);
    var metadata = payload.metadata;
    var head = node("div", "source-detail-head");
    var title = node("div");
    title.append(
      node("p", "eyebrow", "Documento governado"),
      node("h3", "", metadata.title)
    );
    var back = node("a", "text-button", "Voltar à decisão");
    back.href = sourceBackHref();
    back.addEventListener("click", function (event) {
      event.preventDefault();
      closeSourcePanel(true);
    });
    head.append(title, back);
    panel.appendChild(head);
    renderSourceMetadata(panel, metadata);
    var access = node("div", "source-access");
    access.setAttribute("data-access", payload.access);
    access.append(
      node("strong", "", payload.access === "available" ? "Conteúdo disponível" : "Acesso governado"),
      node("span", "", payload.message)
    );
    panel.appendChild(access);
    if (payload.access === "available" && typeof payload.content === "string") {
      renderDocumentContent(panel, payload.content, span);
    }
  }

  function openSourcePanel(trigger, focusPanel) {
    sourceReturnFocus = trigger || sourceReturnFocus;
    var rail = byId("source-inventory");
    var drawerMode = window.matchMedia("(max-width: 1120px)").matches;
    rail.classList.add("is-expanded");
    byId("source-backdrop").hidden = !drawerMode;
    document.body.classList.toggle("source-drawer-open", drawerMode);
    if (focusPanel) {
      window.setTimeout(function () {
        if (drawerMode) byId("source-close").focus();
        else byId("source-search").focus();
      }, 50);
    }
  }

  function closeSourcePanel(useHistory) {
    var rail = byId("source-inventory");
    rail.classList.remove("is-expanded");
    byId("source-backdrop").hidden = true;
    document.body.classList.remove("source-drawer-open");
    if (useHistory && window.location.pathname.startsWith("/sources")) {
      window.history.replaceState({ sourceOverlay: false }, "", sourceBackHref());
    }
    if (sourceReturnFocus && typeof sourceReturnFocus.focus === "function") {
      sourceReturnFocus.focus();
    }
  }

  function showSource(sourceId, versionId, span, pushRoute, trigger) {
    selectedSource = {
      sourceId: sourceId,
      versionId: versionId,
      startByte: span && Number.isInteger(span.startByte) ? span.startByte : null,
      endByte: span && Number.isInteger(span.endByte) ? span.endByte : null,
      claimId: span && span.claimId ? span.claimId : null
    };
    var entry = activeEntry();
    if (entry) {
      entry.selectedSource = selectedSource;
      updateEntry(entry);
    }
    document.querySelectorAll(".source-item").forEach(function (item) {
      item.setAttribute("aria-current", item.getAttribute("data-source-id") === sourceId ? "true" : "false");
    });
    openSourcePanel(trigger, false);
    var panel = byId("source-detail");
    clear(panel);
    panel.appendChild(node("p", "history-empty", "Carregando documento governado…"));
    if (pushRoute) {
      window.history.pushState(
        { sourceOverlay: true, sourceId: sourceId, versionId: versionId },
        "",
        sourceHref(sourceId, versionId, span)
      );
    }
    safeRequest(sourceApiPath(sourceId, versionId))
      .then(function (payload) {
        renderSourceDetail(payload, span);
        panel.focus();
        if (!span) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(function () {
        clear(panel);
        var metadata = documentFor(sourceId, versionId);
        panel.appendChild(node("h3", "", metadata ? metadata.title : "Fonte não disponível"));
        if (metadata) renderSourceMetadata(panel, metadata);
        var unavailable = node("div", "source-access");
        unavailable.setAttribute("data-access", "restricted");
        unavailable.append(
          node("strong", "", "Visualização integral indisponível"),
          node("span", "", "O conteúdo protegido não foi exposto.")
        );
        panel.appendChild(unavailable);
        if (span && typeof span.quote === "string" && span.quote) {
          panel.appendChild(node("h4", "section-title", "Trecho já citado na decisão"));
          var citedExcerpt = node("pre", "source-document");
          var citedMark = node("mark", "", span.quote);
          citedMark.id = "evidence-highlight";
          citedExcerpt.appendChild(citedMark);
          panel.appendChild(citedExcerpt);
        }
      });
  }

  function replaceCorpusRoute() {
    var filters = currentFilters();
    var params = sourceContextParams();
    Object.entries(filters).forEach(function (pair) {
      if (pair[1]) params.set(pair[0], pair[1]);
    });
    window.history.replaceState({ sourceOverlay: true }, "", "/sources?" + params.toString());
  }

  function applySourceRoute() {
    var params = new URLSearchParams(window.location.search);
    byId("source-search").value = params.get("search") || "";
    byId("filter-domain").value = params.get("domain") || "";
    byId("filter-approval").value = params.get("approval") || "";
    byId("filter-audience").value = params.get("audience") || "";
    byId("filter-type").value = params.get("type") || "";
    var route = window.location.pathname.match(/^\/sources\/([^/]+)\/([^/]+)$/);
    if (route) {
      var startByte = Number(params.get("startByte"));
      var endByte = Number(params.get("endByte"));
      showSource(
        decodeURIComponent(route[1]),
        decodeURIComponent(route[2]),
        Number.isInteger(startByte) && Number.isInteger(endByte)
          ? { startByte: startByte, endByte: endByte }
          : null,
        false,
        null
      );
    } else if (window.location.pathname === "/sources") {
      openSourcePanel(null, false);
      var sourceId = params.get("sourceId");
      var metadata = sourceId ? documentFor(sourceId) : null;
      if (metadata) showSource(metadata.sourceId, metadata.versionId, null, false, null);
    }
  }

  function clearSourceFilters() {
    byId("source-search").value = "";
    byId("filter-domain").value = "";
    byId("filter-approval").value = "";
    byId("filter-audience").value = "";
    byId("filter-type").value = "";
    renderSourceList();
    replaceCorpusRoute();
  }

  function trapSourceFocus(event) {
    if (
      event.key !== "Tab"
      || !byId("source-inventory").classList.contains("is-expanded")
      || !window.matchMedia("(max-width: 1120px)").matches
    ) return;
    var focusable = Array.from(byId("source-inventory").querySelectorAll(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']"
    )).filter(function (element) {
      return !element.hidden && element.getClientRects().length > 0;
    });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindEvents() {
    byId("request-form").addEventListener("submit", function (event) {
      event.preventDefault();
      submitDecision(byId("question-input").value, false, byId("submit-decision"));
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
    document.querySelectorAll("[data-new-decision]").forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        startNewThread("", "");
      });
    });
    byId("edit-question").addEventListener("click", function () {
      var entry = activeEntry();
      startNewThread("", entry ? entry.question : "");
    });
    byId("profile-select").addEventListener("change", changeTrustedContext);
    byId("effective-date").addEventListener("change", changeTrustedContext);
    ["source-search", "filter-domain", "filter-approval", "filter-audience", "filter-type"].forEach(function (id) {
      byId(id).addEventListener(id === "source-search" ? "input" : "change", function () {
        renderSourceList();
        if (window.location.pathname === "/sources") replaceCorpusRoute();
      });
    });
    byId("clear-source-filters").addEventListener("click", clearSourceFilters);
    document.querySelectorAll("[data-open-sources]").forEach(function (trigger) {
      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        if (!window.location.pathname.startsWith("/sources")) {
          window.history.pushState({ sourceOverlay: true }, "", filteredCorpusHref("", ""));
        }
        openSourcePanel(trigger, true);
      });
    });
    byId("source-close").addEventListener("click", function () {
      closeSourcePanel(true);
    });
    byId("source-backdrop").addEventListener("click", function () {
      closeSourcePanel(true);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && byId("source-inventory").classList.contains("is-expanded")) {
        closeSourcePanel(true);
      } else {
        trapSourceFocus(event);
      }
    });
    window.addEventListener("popstate", function () {
      if (window.location.pathname.startsWith("/sources")) {
        applySourceRoute();
        renderSourceList();
      } else {
        closeSourcePanel(false);
      }
    });
  }

  function initialize() {
    loadEntries();
    bindEvents();
    Promise.all([
      safeRequest("/healthz"),
      safeRequest("/api/profiles"),
      safeRequest("/api/corpus")
    ]).then(function (payloads) {
      renderProfiles(payloads[1]);
      renderCorpus(payloads[2]);
      renderHistory();
      renderTimeline();
      byId("service-state").setAttribute("data-state", "ok");
      byId("service-label").textContent = payloads[2].totals.documents + " fontes prontas";
    }).catch(function () {
      byId("service-state").setAttribute("data-state", "error");
      byId("service-label").textContent = "Serviço indisponível";
      showError(function () {
        window.location.reload();
      });
    });
  }

  initialize();
}());
