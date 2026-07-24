import { createHash } from "node:crypto";
import {
  answerRequirement,
  rankEligible,
  retrievalStrength,
  selectAnswerCandidates,
} from "./answer-support.ts";
import { retrievalQuestionFor } from "./conversation.ts";
import { loadSourceDocuments } from "./corpus.ts";
import { RETRIEVAL_LIMITS } from "./domain-config.ts";
import { evidenceForQuote } from "./evidence.ts";
import { activeSupersededSources, detectConflicts, evaluateEligibility } from "./governance.ts";
import { createHandoff } from "./queue.ts";
import { lexicalIndex, tokenize } from "./retrieval.ts";
import { runtimeSemanticSearch } from "./runtime.ts";
import { fuseRetrieval } from "./semantic.ts";
import { saveTrace } from "./traces.ts";
import type {
  Claim,
  DecideRequest,
  Decision,
  DecisionTrace,
  EligibilityRejectionCode,
  HandoffReason,
  RetrievalCandidate,
  EvidenceConfidence,
} from "./types.ts";

const PIPELINE_VERSION = "hybrid-governed-v3";
const MIN_RELEVANCE = RETRIEVAL_LIMITS.minimumRelevance;
const MAX_GOVERNED_CANDIDATES = RETRIEVAL_LIMITS.maximumGovernedCandidates;

const REGION_ALIASES: Array<{ baseId: string; aliases: string[] }> = [
  { baseId: "CENTRO_OESTE", aliases: ["planalto central", "planalto", "centro-oeste", "centro oeste"] },
  { baseId: "SUDESTE", aliases: ["metropolitano", "metropolitana", "sudeste"] },
  { baseId: "SUL", aliases: ["costa sul", "sul"] },
];

const CONVERSATIONAL_PATTERNS = [
  /^(?:oi|olá|ola|bom dia|boa tarde|boa noite)[!,.?\s]*$/iu,
  /^(?:oi|olá|ola)[,!.\s]+(?:tudo bem|como vai)[!,.?\s]*$/iu,
  /^(?:bom dia|boa tarde|boa noite)[,!.\s]+(?:tudo bem|como vai)[!,.?\s]*$/iu,
  /^(?:obrigad[oa]|valeu|agradeço|agradeco)[!,.?\s]*$/iu,
  /^(?:obrigad[oa]|valeu|agradeço|agradeco)\b.{0,80}$/iu,
  /^(?:tudo bem|como você está|como voce esta)[!,.?\s]*$/iu,
];

const PEOPLE_OPS_SCOPE_PATTERNS = [
  /\b(?:people operations|people ops|recursos humanos|rh)\b/u,
  /\b(?:preciso|gostaria|quero)\s+de\s+(?:uma\s+)?(?:orientacao|ajuda)\b/u,
  /\b(?:admissao|contratacao|ingresso|onboarding|candidat[oa]s?|pre-ingresso)\b/u,
  /\b(?:certificacao|treinamento|capacitacao|desenvolvimento profissional)\b/u,
  /\b(?:ferias?|descanso programado|afastamento|ausencias?|licenca|atestado|laudo|maternidade|paternidade)\b/u,
  /\b(?:salario|remuneracao|folha de pagamento|pagamento|holerite|contracheque|comprovante mensal|decimo terceiro|auxilio|beneficio|refeicao|alimentacao)\b/u,
  /\b(?:registro de jornada|controle de jornada|jornada|horas? extras?|horas? adicionais|banco de horas|ponto eletronico|marcacao de ponto|batida de ponto|escala de trabalho|retorno do intervalo)\b/u,
  /\b(?:marcar|registrar)\b[\s\S]{0,35}\b(?:entrada|saida|intervalo|ponto)\b/u,
  /\b(?:registros?|marcacoes?)\b[\s\S]{0,35}\b(?:ponto|expediente|jornada)\b|\b(?:ponto|expediente|jornada)\b[\s\S]{0,35}\b(?:registros?|marcacoes?)\b/u,
  /\bpolitica\b[\s\S]{0,35}\b(?:ponto|jornada|ferias?|folha|admissao|desligamento)\b/u,
  /\b(?:solicitacao|pedido|correcao|ajuste)\b[\s\S]{0,45}\b(?:ponto|jornada|horas?)\b|\b(?:ponto|jornada|horas?)\b[\s\S]{0,45}\b(?:solicitacao|pedido|correcao|ajuste)\b/u,
  /\b(?:trabalhar|trabalho|horas?)\b[\s\S]{0,55}\b(?:depois do|alem do|fora do)\s+(?:meu\s+)?(?:horario|expediente)\b/u,
  /\bpago a mais\b[\s\S]{0,55}\b(?:horas?|horario|expediente)\b|\b(?:horas?|horario|expediente)\b[\s\S]{0,55}\bpago a mais\b/u,
  /\bcompensacao\b[\s\S]{0,55}\b(?:horas?|jornada|periodo extraordinario)\b|\b(?:horas?|jornada|periodo extraordinario)\b[\s\S]{0,55}\bcompensacao\b/u,
  /\b(?:mudanca|alteracao)\b[\s\S]{0,45}\bescala\b|\bescala\b[\s\S]{0,45}\b(?:antecedencia|comunicad[oa])\b/u,
  /\b(?:ajuste|correcao|comprovante|folha|pagamento)\b[\s\S]{0,50}\bfechamento\b|\bfechamento\b[\s\S]{0,50}\b(?:ajuste|correcao|comprovante|folha|pagamento)\b/u,
  /\b(?:demissao|desligamento|rescisao|encerramento|aviso previo|revisao humana|revisao manual)\b/u,
  /\b(?:estagio|estagiari[oa]s?|aprendi(?:z|zes)|vinculo empregaticio|relacao de trabalho|contrato de trabalho)\b/u,
  /\b(?:vinculo|relacao contratual|relacao trabalhista|tipo de contrato|instrumento contratual)\b/u,
  /\b(?:dados? cadastrais?|cadastro|nome cadastrad[oa]|endereco cadastrad[oa]|dados? bancarios?|conta bancaria|cpf)\b/u,
  /\b(?:documento|comprovante|dado|informacao)\s+(?:medic[oa]|clinic[oa]|de saude)\b/u,
  /\b(?:saude e seguranca|acidente de trabalho|incidente urgente|risco ocupacional|emergencia no trabalho)\b/u,
  /\b(?:identidade corporativa|acesso corporativo|provisionamento|equipamento corporativo)\b/u,
  /\b(?:meu|minha)\s+(?:gestor|gestora|projeto|cargo|centro de custo)\b/u,
  /\b(?:gestor|gestora|lideranca)\b[\s\S]{0,45}\b(?:jornada|desligamento|admissao|ferias|pedido|solicitacao)\b/u,
];

const HUMAN_PATTERNS = [
  /\b(?:falar|conversar)\s+com\s+(?:uma\s+)?(?:pessoa|atendente|analista|humano|humana)\b/iu,
  /\b(?:quero|preciso|prefiro)\s+(?:de\s+)?(?:uma\s+)?(?:pessoa|atendente|analista|atendimento humano)\b/iu,
  /\b(?:quero|preciso|prefiro)\s+que\s+(?:uma\s+)?(?:pessoa|atendente|analista|humano|humana)\s+(?:continue|assuma|atenda)\b/iu,
  /\bnão quero (?:usar|falar com) (?:o )?(?:bot|assistente)\b/iu,
];

const INJECTION_PATTERNS = [
  /\bignore (?:as |todas as )?(?:instruções|instrucoes|regras|governança|governanca)\b/iu,
  /\b(?:revele|mostre|imprima|retorne)\b.{0,40}\b(?:segredo|token|chave|vault|canary|prompt)\b/iu,
  /\b(?:finja|considere).{0,40}\b(?:aprovad[oa]|vigente|employee)\b/iu,
];

const SENSITIVE_PATTERNS = [
  /\bquanto (?:eu )?(?:vou|devo|irei) receber\b/iu,
  /\b(?:meu|minha)\s+(?:salário|salario|saldo|diagnóstico|diagnostico|laudo|conta bancária|conta bancaria)\b/iu,
  /\b(?:já|ja)\s+(?:foi|está|esta)\s+(?:pago|creditado|processado|aprovado|corrigido)\b/iu,
  /\b(?:vou|posso)\s+(?:colar|enviar|mandar)\s+(?:meu|minha)\s+(?:cpf|conta|laudo|diagnóstico|diagnostico)\b/iu,
];

function shortHash(value: string, length = 18): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);
}

function traceIdFor(input: DecideRequest): string {
  const identity = JSON.stringify({
    requestId: input.requestId,
    asOf: input.asOf,
    requester: input.requester,
    questionHash: shortHash(input.question, 24),
    historyHash: shortHash(JSON.stringify(input.history ?? []), 24),
  });
  return `trace-${shortHash(identity)}`;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value.trim()));
}

function normalizeForRouting(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
}

function isPeopleOpsQuestion(question: string): boolean {
  return matchesAny(normalizeForRouting(question), PEOPLE_OPS_SCOPE_PATTERNS);
}

function asksLiveIndividualState(question: string): boolean {
  const text = normalizeForRouting(question);
  const personal = /\b(?:eu|meu|minha|meus|minhas|rh)\b/u.test(text);
  const transactional = /\b(?:solicitacao|pedido|correcao|ajuste|saldo|acesso|identidade|pagamento|afastamento|ferias|horas|desligamento|cadastro|cargo|gestor|projeto)\b/u.test(text);
  const status = /\b(?:aprovad[oa]|aprovou|processad[oa]|processou|andamento|pendente|concluid[oa]|criad[oa]|corrigiram|corrigiu|ja foi|ainda esta|status)\b/u.test(text);
  const personalBalance = personal && (
    /\bsaldo\b[\s\S]{0,50}\b(?:ferias?|horas)\b|\b(?:ferias?|horas)\b[\s\S]{0,50}\bsaldo\b/u.test(text) ||
    /\b(?:ferias?|dias)\b[\s\S]{0,60}\b(?:disponiveis?|restam|restantes?|usei|gozei|ainda tenho)\b/u.test(text)
  );
  const asksForRecordValue = /\b(?:qual|quem|quanto|quantos|onde)\b/u.test(text) &&
    /\b(?:meu|minha)\b[\s\S]{0,35}\b(?:gestor|gestora|projeto|cargo|endereco cadastrad[oa]|nome cadastrad[oa]|centro de custo)\b/u.test(text) &&
    !/\b(?:pode|deve|politica|procedimento|regra|qual canal|como)\b/u.test(text);
  return personalBalance || asksForRecordValue || (personal && transactional && status);
}

function explicitRegion(question: string): string | undefined {
  const normalized = question.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
  return REGION_ALIASES.find((region) => region.aliases.some((alias) => normalized.includes(alias)))?.baseId;
}

function sourceMatchesRequestedRegion(candidate: RetrievalCandidate, baseId: string | undefined): boolean {
  return !baseId || candidate.document.eligibility.baseIds.includes("*") || candidate.document.eligibility.baseIds.includes(baseId);
}

function uniqueSourceCandidates(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const unique = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.document.sourceId}@${candidate.document.versionId}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function primaryRejection(rejections: EligibilityRejectionCode[]): EligibilityRejectionCode {
  const priority: EligibilityRejectionCode[] = [
    "approval", "sensitivity", "audience", "scope", "future", "expired", "superseded",
  ];
  return priority.find((code) => rejections.includes(code)) ?? rejections[0] ?? "scope";
}

function deferReasonForRejected(candidates: Array<{
  candidate: RetrievalCandidate;
  rejectionCodes: EligibilityRejectionCode[];
}>): HandoffReason {
  const codes = new Set(candidates.flatMap((item) => item.rejectionCodes));
  const hasPending = candidates.some((item) => item.candidate.document.approval === "pending");
  if (hasPending || codes.has("approval")) {
    return "validation_pending";
  }
  if (codes.has("sensitivity") || codes.has("audience")) return "policy_sensitive_source";
  if (codes.has("scope")) return "profile_mismatch";
  if (codes.has("future") || codes.has("expired") || codes.has("superseded")) return "missing_source";
  return "missing_source";
}

function messageFor(reason: HandoffReason): string {
  const messages: Record<HandoffReason, string> = {
    human_requested: "Certo. Encaminhei a solicitação para uma pessoa de People Operations, com o contexto desta conversa.",
    low_confidence: "Não encontrei evidência suficientemente clara para orientar com segurança. People Operations vai revisar a dúvida.",
    conflicting_source: "As fontes aplicáveis divergem sobre esta orientação. A governança de conhecimento vai confirmar qual regra deve prevalecer.",
    missing_source: "O acervo aprovado não contém evidência suficiente para responder com segurança. A governança de conhecimento vai verificar a lacuna.",
    profile_mismatch: "As fontes localizadas não cobrem o perfil confirmado nesta sessão. People Operations vai avaliar o caso sem pedir que você recomece.",
    sensitive_topic: "Este pedido envolve informação individual ou sensível. O atendimento continuará com a equipe autorizada no canal protegido.",
    validation_pending: "A fonte relevante não está aprovada e vigente para esta decisão. A governança de conhecimento vai validar a orientação.",
    policy_sensitive_source: "A informação localizada é interna ou restrita e não pode sustentar uma resposta neste canal. O responsável fará a revisão.",
    provider_failure: "Não foi possível concluir a consulta automaticamente. People Operations continuará o atendimento enquanto a plataforma é verificada.",
  };
  return messages[reason];
}

function explainedDeferMessage(
  reason: HandoffReason,
  rejected: Array<{ candidate: RetrievalCandidate; rejectionCodes: EligibilityRejectionCode[] }>,
): string {
  if (reason === "missing_source" && rejected.some((item) => item.rejectionCodes.includes("expired") || item.rejectionCodes.includes("future"))) {
    const title = rejected.find((item) => item.rejectionCodes.includes("expired") || item.rejectionCodes.includes("future"))?.candidate.document.title;
    return `Não encontrei uma fonte vigente e aplicável para essa resposta na data consultada${title ? `; ${title} estava fora do período de vigência` : ""}. A solicitação foi encaminhada para validação.`;
  }
  if (reason === "profile_mismatch" && rejected.some((item) => item.rejectionCodes.includes("scope"))) {
    return "Encontrei fontes relacionadas, mas elas não cobrem a entidade, base ou relação de trabalho deste perfil. People Operations vai validar a orientação aplicável.";
  }
  return messageFor(reason);
}

function emptyGovernanceTrace(
  input: DecideRequest,
  traceId: string,
  kind: Decision["kind"],
  reasonCode: HandoffReason | undefined,
  started: number,
  note: string,
): DecisionTrace {
  return {
    traceId,
    requestId: input.requestId,
    createdAt: new Date().toISOString(),
    decisionKind: kind,
    pipelineVersion: PIPELINE_VERSION,
    indexVersion: "corpus-sha256-v1",
    stages: ["retrieval", "governance", "decision"],
    governance: {
      candidateCount: 0,
      eligibleCount: 0,
      rejectedCount: 0,
      eligibleSources: [],
      rejectionReasons: {},
    },
    route: { kind, ...(reasonCode ? { reasonCode } : {}) },
    provider: { status: "not_used" },
    consideredEvidence: [],
    timingsMs: {
      retrieval: 0,
      governance: 0,
      decision: Math.max(0, performance.now() - started),
      total: Math.max(0, performance.now() - started),
    },
    notes: [note],
  };
}

function createClaims(candidates: RetrievalCandidate[]): Claim[] {
  return candidates.map((candidate, index) => ({
    id: `claim-${index + 1}`,
    text: candidate.passage.answerText,
    evidence: [
      evidenceForQuote(
        candidate.document,
        candidate.passage.answerText,
        candidate.passage.startCharacter,
      ),
    ],
    supportType: index === 0 ? "primary" : "supporting",
    evidenceUsage: (() => {
      const citation = evidenceForQuote(candidate.document, candidate.passage.answerText, candidate.passage.startCharacter);
      return [{ sourceId: candidate.document.sourceId, passageId: candidate.passage.id, title: candidate.document.title,
        role: index === 0 ? "primary" as const : "supporting" as const, supports: [candidate.document.domain], citation }];
    })(),
  }));
}

function evidenceConfidence(
  decision: Decision,
  selected: RetrievalCandidate[],
  conflicts: ReturnType<typeof detectConflicts>,
  region: string | undefined,
): EvidenceConfidence {
  if (decision.kind === "defer") {
    const highConfidenceDefer = decision.handoff.reasonCode === "missing_source" || decision.handoff.reasonCode === "sensitive_topic";
    return { level: highConfidenceDefer ? "high" : "low", score: highConfidenceDefer ? 0.9 : 0.3,
      reasons: highConfidenceDefer ? ["governance_prevents_supported_answer"] : ["insufficient_or_conflicting_evidence"],
      penalties: conflicts.length > 0 ? ["conflicting_eligible_sources"] : [] };
  }
  const primary = selected[0];
  const explicit = (primary?.sufficiencyScore ?? 0) > 0;
  const score = Math.min(0.96, 0.55 + (explicit ? 0.18 : 0) + (primary?.document.authorityTier ?? 0) / 500 + (region ? 0.04 : 0));
  return { level: score >= 0.85 ? "high" : score >= 0.65 ? "medium" : "low", score,
    reasons: ["eligible_current_source", "exact_citation", explicit ? "answer_type_sufficient" : "indirect_evidence", ...(region ? ["explicit_region_resolved"] : [])],
    penalties: conflicts.length ? ["conflicting_eligible_sources"] : [] };
}

function saveRoutingTrace(
  input: DecideRequest,
  traceId: string,
  decision: Decision,
  candidates: RetrievalCandidate[],
  eligible: RetrievalCandidate[],
  rejected: Array<{ candidate: RetrievalCandidate; rejectionCodes: EligibilityRejectionCode[] }>,
  conflicts: ReturnType<typeof detectConflicts>,
  retrieval: {
    queryTokens: string[];
    expandedTerms?: string[];
    concepts?: string[];
    explicitRegion?: string;
    resolvedRegion?: string;
    requirement?: string;
    providerStatus: "ok" | "degraded";
    contextualized?: boolean;
    contextualTurns?: number;
  },
  confidence: EvidenceConfidence,
  timings: { retrieval: number; governance: number; decision: number; total: number },
): void {
  const uniqueCandidates = uniqueSourceCandidates(candidates);
  const uniqueEligible = uniqueSourceCandidates(eligible);
  const uniqueRejected = new Map<string, {
    candidate: RetrievalCandidate;
    rejectionCodes: EligibilityRejectionCode[];
  }>();
  for (const item of rejected) {
    const key = `${item.candidate.document.sourceId}@${item.candidate.document.versionId}`;
    if (!uniqueRejected.has(key)) uniqueRejected.set(key, item);
  }
  const rejectionReasons: Record<string, number> = {};
  for (const item of uniqueRejected.values()) {
    const reason = primaryRejection(item.rejectionCodes);
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }
  const trace: DecisionTrace = {
    traceId,
    requestId: input.requestId,
    createdAt: new Date().toISOString(),
    decisionKind: decision.kind,
    pipelineVersion: PIPELINE_VERSION,
    indexVersion: "hybrid-rrf-e5-v2",
    stages: ["retrieval", "governance", "decision"],
    governance: {
      candidateCount: uniqueCandidates.length,
      eligibleCount: uniqueEligible.length,
      rejectedCount: uniqueRejected.size,
      eligibleSources: uniqueEligible.map((item) => ({
        sourceId: item.document.sourceId,
        versionId: item.document.versionId,
      })),
      rejectionReasons,
    },
    route: {
      kind: decision.kind,
      ...(decision.kind === "defer" ? { reasonCode: decision.handoff.reasonCode } : {}),
    },
    provider: { status: retrieval.providerStatus },
    consideredEvidence: candidates.map((candidate, index) => ({
      sourceId: candidate.document.sourceId,
      versionId: candidate.document.versionId,
      startByte: candidate.passage.startByte,
      endByte: candidate.passage.endByte,
      rank: index + 1,
      stage: eligible.some((item) => item.passage.id === candidate.passage.id)
        ? "eligible"
        : "rejected",
      score: Number(retrievalStrength(candidate).toFixed(4)),
      passageId: candidate.passage.id,
      lexicalScore: candidate.lexicalScore === undefined ? undefined : Number(candidate.lexicalScore.toFixed(4)),
      semanticScore: candidate.semanticScore === undefined ? undefined : Number(candidate.semanticScore.toFixed(4)),
      fusionScore: candidate.fusionScore === undefined ? undefined : Number(candidate.fusionScore.toFixed(6)),
      finalScore: candidate.finalScore === undefined ? undefined : Number(candidate.finalScore.toFixed(4)),
      rejectionCodes: rejected.find((item) => item.candidate.passage.id === candidate.passage.id)?.rejectionCodes,
      selectedAsEvidence: decision.kind === "answer" && decision.claims.some((claim) => claim.evidence.some((evidence) =>
        evidence.sourceId === candidate.document.sourceId && candidate.passage.text.includes(evidence.quote))),
    })),
    timingsMs: {
      retrieval: Number(timings.retrieval.toFixed(3)),
      governance: Number(timings.governance.toFixed(3)),
      decision: Number(timings.decision.toFixed(3)),
      total: Number(timings.total.toFixed(3)),
    },
    conflicts: conflicts.map((conflict) => ({
      domain: conflict.domain,
      sourceIds: [conflict.left.document.sourceId, conflict.right.document.sourceId],
      signals: conflict.signals,
    })),
    notes: [
      `${tokenize(input.question).length} normalized query terms; source and requester text treated as untrusted data.`,
      "Governance was applied deterministically before response rendering.",
      ...(retrieval.contextualized
        ? [`${retrieval.contextualTurns ?? 1} completed user question(s) were used for retrieval context; assistant history was not treated as evidence.`]
        : []),
    ],
    retrievalDiagnostics: {
      queryTokens: retrieval.queryTokens,
      expandedTerms: retrieval.expandedTerms ?? [],
      concepts: retrieval.concepts ?? [],
      explicitRegion: retrieval.explicitRegion,
      resolvedRegion: retrieval.resolvedRegion,
      answerRequirement: retrieval.requirement,
    },
    confidence,
  };
  saveTrace(trace);
}

function deferredDecision(
  input: DecideRequest,
  traceId: string,
  reason: HandoffReason,
  score: number,
  rejected: Array<{ candidate: RetrievalCandidate; rejectionCodes: EligibilityRejectionCode[] }> = [],
): Decision {
  return {
    kind: "defer",
    answerabilityScore: Math.max(0, Math.min(1, score)),
    userMessage: explainedDeferMessage(reason, rejected),
    handoff: createHandoff(input, reason, traceId),
    traceId,
  };
}

export async function decide(input: DecideRequest): Promise<Decision> {
  const started = performance.now();
  const traceId = traceIdFor(input);
  const retrievalContext = retrievalQuestionFor(input, isPeopleOpsQuestion);

  if (matchesAny(input.question, CONVERSATIONAL_PATTERNS)) {
    const trimmed = input.question.trim();
    const body = /^(?:obrigad[oa]|valeu|agradeço|agradeco)\b/iu.test(trimmed)
      ? "De nada. Estou à disposição para outras dúvidas sobre People Operations."
      : /^(?:bom dia|boa tarde|boa noite)\b/iu.test(trimmed)
        ? `${trimmed.match(/^(bom dia|boa tarde|boa noite)/iu)?.[1] ?? "Olá"}. Como posso ajudar com políticas ou processos de People Operations?`
        : "Olá! Posso orientar sobre políticas e processos de People Operations ou encaminhar o atendimento para uma pessoa.";
    const decision: Decision = {
      kind: "conversational",
      body,
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started, "No policy decision was requested."));
    return decision;
  }

  if (matchesAny(input.question, HUMAN_PATTERNS)) {
    const reason: HandoffReason = "human_requested";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The requester explicitly asked for a person."));
    return deferredDecision(input, traceId, reason, 0);
  }

  if (matchesAny(input.question, INJECTION_PATTERNS)) {
    const reason: HandoffReason = "policy_sensitive_source";
    const trace = emptyGovernanceTrace(input, traceId, "defer", reason, started, "Untrusted text attempted to alter governance or disclose protected data.");
    trace.governance = {
      candidateCount: 1,
      eligibleCount: 0,
      rejectedCount: 1,
      eligibleSources: [],
      rejectionReasons: { sensitivity: 1 },
    };
    saveTrace(trace);
    return deferredDecision(input, traceId, reason, 0);
  }

  const asksPolicyCapability = /\b(?:pol[ií]tica|procedimento|regra)\b.*\b(?:confirmar|mostrar|informar)\b/iu.test(input.question);
  if (!asksPolicyCapability && asksLiveIndividualState(input.question)) {
    const reason: HandoffReason = "sensitive_topic";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The request requires live individual transactional state, which static governed sources do not provide."));
    return deferredDecision(input, traceId, reason, 0.96);
  }

  if (!isPeopleOpsQuestion(retrievalContext.question)) {
    const decision: Decision = {
      kind: "conversational",
      body: "Este atendimento é limitado a políticas e processos de People Operations. Posso ajudar com uma dúvida desse contexto.",
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started, "The question is outside the People Operations scope."));
    return decision;
  }

  if (!asksPolicyCapability && matchesAny(input.question, SENSITIVE_PATTERNS)) {
    const reason: HandoffReason = "sensitive_topic";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The request concerns individual or protected state."));
    return deferredDecision(input, traceId, reason, 0.05);
  }

  const documents = loadSourceDocuments();
  const retrievalStarted = performance.now();
  const retrieval = lexicalIndex(documents).search(retrievalContext.question);
  const semantic = await runtimeSemanticSearch(documents, retrievalContext.question, 28);
  const semanticProviderStatus = semantic.mode === "learned" ? "ok" : "degraded";
  const hybridCandidates = fuseRetrieval(retrieval.candidates, semantic.candidates, 48);
  const retrievalMs = performance.now() - retrievalStarted;
  const topScore = hybridCandidates.reduce((strongest, candidate) =>
    Math.max(strongest, retrievalStrength(candidate)), 0);
  const relevanceFloor = Math.max(0.55, topScore * 0.12);
  // Govern passages first: a later clause in the same source can be the only sufficient answer.
  const requestedRegion = explicitRegion(input.question);
  const resolvedRegion = input.requester.baseId;
  const candidates = hybridCandidates
    .filter((candidate) => sourceMatchesRequestedRegion(candidate, requestedRegion))
    .filter((candidate) => retrievalStrength(candidate) >= relevanceFloor)
    .slice(0, MAX_GOVERNED_CANDIDATES);

  const governanceStarted = performance.now();
  const superseded = activeSupersededSources(documents, input);
  const eligible: RetrievalCandidate[] = [];
  const rejected: Array<{ candidate: RetrievalCandidate; rejectionCodes: EligibilityRejectionCode[] }> = [];
  for (const candidate of candidates) {
    const result = evaluateEligibility(candidate.document, input, superseded);
    if (result.eligible) {
      eligible.push(candidate);
    } else {
      rejected.push({
        candidate,
        rejectionCodes: result.rejections.map((rejection) => rejection.code),
      });
    }
  }
  const requirement = answerRequirement(input.question);
  const rankedEligible = rankEligible(eligible, input, requirement);
  const conflictCandidates = rankedEligible.filter((candidate) =>
    (candidate.sufficiencyScore ?? 0) > 0 && retrievalStrength(candidate) >= topScore * 0.45);
  const conflicts = detectConflicts(conflictCandidates);
  if (requirement === "location_or_channel") {
    const channels = new Map<string, RetrievalCandidate>();
    for (const candidate of rankedEligible.filter((item) => (item.sufficiencyScore ?? 0) > 0)) {
      const channel = candidate.passage.answerText.match(/\b(Cais|Orla)\b/iu)?.[1]?.toLocaleLowerCase("pt-BR");
      if (channel && !channels.has(channel)) channels.set(channel, candidate);
    }
    const values = [...channels.values()];
    if (values.length > 1) conflicts.push({ domain: "admission_document_submission_channel", left: values[0]!, right: values[1]!, signals: ["incompatible_submission_channel"] });
  }
  const governanceMs = performance.now() - governanceStarted;
  const regionProfileMismatch = requestedRegion !== undefined &&
    requestedRegion !== input.requester.baseId &&
    rejected.some((item) => item.rejectionCodes.includes("scope"));

  const decisionStarted = performance.now();
  let decision: Decision;
  let confidence: EvidenceConfidence;
  if (candidates.length === 0 || topScore < MIN_RELEVANCE) {
    decision = deferredDecision(input, traceId, "missing_source", 0.08);
  } else if (regionProfileMismatch) {
    decision = deferredDecision(input, traceId, "profile_mismatch", 0.12, rejected);
  } else if (eligible.length === 0) {
    decision = deferredDecision(input, traceId, deferReasonForRejected(rejected), 0.12, rejected);
  } else if (conflicts.length > 0) {
    decision = deferredDecision(input, traceId, "conflicting_source", 0.2);
  } else {
    const answerCandidates = selectAnswerCandidates(rankedEligible, input.question);
    if (answerCandidates.length === 0) {
      decision = deferredDecision(input, traceId, "missing_source", 0.18, rejected);
    } else {
      const claims = createClaims(answerCandidates);
      decision = {
        kind: "answer",
        answerabilityScore: Math.min(0.96, 0.62 + topScore / 40 + (claims.length > 1 ? 0.06 : 0)),
        body: claims.map((claim) => claim.text).join("\n\n"),
        claims,
        traceId,
      };
    }
  }
  const selectedForConfidence = decision.kind === "answer"
    ? rankedEligible.filter((candidate) => decision.claims.some((claim) => claim.evidence.some((evidence) =>
      evidence.sourceId === candidate.document.sourceId && candidate.passage.text.includes(evidence.quote))))
    : [];
  confidence = evidenceConfidence(
    decision,
    selectedForConfidence,
    conflicts,
    requestedRegion === input.requester.baseId ? requestedRegion : undefined,
  );
  if (decision.kind === "answer") {
    decision.claims = decision.claims.map((claim) => ({ ...claim, confidence }));
  }
  const decisionMs = performance.now() - decisionStarted;
  saveRoutingTrace(input, traceId, decision, candidates, rankedEligible, rejected, conflicts,
    { queryTokens: retrieval.queryTokens, expandedTerms: retrieval.expandedTerms, concepts: retrieval.concepts,
      explicitRegion: requestedRegion, resolvedRegion, requirement, providerStatus: semanticProviderStatus,
      contextualized: retrievalContext.usedHistory, contextualTurns: retrievalContext.contextualTurns }, confidence,
    { retrieval: retrievalMs, governance: governanceMs, decision: decisionMs, total: performance.now() - started });
  return decision;
}
