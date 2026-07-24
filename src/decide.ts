import { createHash } from "node:crypto";
import { loadSourceDocuments } from "./corpus.ts";
import { evidenceForQuote } from "./evidence.ts";
import { activeSupersededSources, detectConflicts, evaluateEligibility } from "./governance.ts";
import { createHandoff } from "./queue.ts";
import { lexicalIndex, tokenize } from "./retrieval.ts";
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

const PIPELINE_VERSION = "lexical-governed-v2";
const MIN_RELEVANCE = 2.35;
const MAX_GOVERNED_CANDIDATES = 28;

const REGION_ALIASES: Array<{ baseId: string; aliases: string[] }> = [
  { baseId: "CENTRO_OESTE", aliases: ["planalto central", "planalto", "centro-oeste", "centro oeste"] },
  { baseId: "SUDESTE", aliases: ["metropolitano", "metropolitana", "sudeste"] },
  { baseId: "SUL", aliases: ["costa sul", "sul"] },
];

type AnswerRequirement = "percentage" | "currency" | "duration" | "list" | "event" | "boolean" | "individual_state" | "general_rule";

const CONVERSATIONAL_PATTERNS = [
  /^(?:oi|olá|ola|bom dia|boa tarde|boa noite)[!,.?\s]*$/iu,
  /^(?:oi|olá|ola)[,!.\s]+(?:tudo bem|como vai)[!,.?\s]*$/iu,
  /^(?:obrigad[oa]|valeu|agradeço|agradeco)[!,.?\s]*$/iu,
  /^(?:tudo bem|como você está|como voce esta)[!,.?\s]*$/iu,
];

const HUMAN_PATTERNS = [
  /\b(?:falar|conversar)\s+com\s+(?:uma\s+)?(?:pessoa|atendente|analista|humano|humana)\b/iu,
  /\b(?:quero|preciso|prefiro)\s+(?:de\s+)?(?:uma\s+)?(?:pessoa|atendente|analista|atendimento humano)\b/iu,
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

function answerRequirement(question: string): AnswerRequirement {
  const normalized = tokenize(question).join(" ");
  if (/\b(?:saldo|estado solicitacao|estado solicitação|espelho individual|ao vivo)\b/iu.test(normalized)) return "individual_state";
  if (/\b(?:extra|extras|horas adicionais|hora adicional|al[eé]m jornada|compensa[cç][aã]o|extraordin[aá]rio)\b/iu.test(question)) return "percentage";
  if (/\b(?:percentual|acrescimo|acréscimo|porcentagem)\b/iu.test(normalized)) return "percentage";
  if (/\b(?:valor|quanto|r\$|apoio|refeicao|refeição)\b/iu.test(normalized)) return "currency";
  if (/\b(?:quantos|dias|prazo|antecedencia|antecedência)\b/iu.test(normalized)) return "duration";
  if (/\b(?:quais|documentos|marcacoes|marcações)\b/iu.test(normalized)) return "list";
  if (/\b(?:ponto|marcacao|marcação|batida|registro|expediente|jornada)\b/iu.test(normalized)) return "list";
  if (/\b(?:revisao|revisão|humana|manual|analista|escalonamento)\b/iu.test(normalized)) return "list";
  if (/\b(?:conversa|gestor|chefe|lideran[cç]a|verbal|informal)\b/iu.test(normalized)) return "boolean";
  if (/\b(?:estagio|estágio|estagiario|estagiário|instrumento|termo)\b/iu.test(normalized)) return "event";
  if (/\b(?:qual evento|antes que|antes de)\b/iu.test(question)) return "event";
  if (/\b(?:suficiente|pode confirmar|consegue confirmar|obrigatoria|obrigatório|obrigatoria|obrigatório)\b/iu.test(question)) return "boolean";
  return "general_rule";
}

function sufficiency(candidate: RetrievalCandidate, requirement: AnswerRequirement): number {
  const text = candidate.passage.answerText;
  const normalized = tokenize(text).join(" ");
  const hasPercent = /\b\d+(?:[,.]\d+)?\s*%/u.test(text);
  const hasCurrency = /R\$\s*\d+(?:[.,]\d+)?/u.test(text);
  const hasDuration = /\b\d+\s+dias?\b|\b(?:primeiro|segundo|terceiro|quarto|quatro|quinto|cinco|sexto|seis) dias?\b/iu.test(text);
  const hasList = /(?:\bdocument\w*\b|\bitens?\b|\bcomprovante\b|\bcasos?\b).*[;,]|\bidentidade\b.*\bcomprovante\b|\bentrada\b.*\bsa[ií]da\b/iu.test(text);
  const hasEvent = /formaliza[cç][aã]o_confirmada|evento|ap[oó]s.*formaliza|instrumento educacional/iu.test(text);
  const hasBoolean = /\b(?:n[aã]o|sim|suficiente|insuficiente|exige|obrigat)/iu.test(text);
  const hasIndividualStateLimit = /saldo ao vivo|espelho individual|estado de solicita[cç][aã]o/iu.test(text);
  const supported = {
    percentage: hasPercent,
    currency: hasCurrency,
    duration: hasDuration,
    list: hasList,
    event: hasEvent,
    boolean: hasBoolean,
    individual_state: hasIndividualStateLimit,
    general_rule: normalized.length > 12,
  }[requirement];
  return supported ? 7 : -18;
}

function scopeSpecificity(candidate: RetrievalCandidate, input: DecideRequest): number {
  const scope = candidate.document.eligibility;
  const matches = [scope.legalEntityIds.includes(input.requester.legalEntityId), scope.baseIds.includes(input.requester.baseId),
    scope.relationships.includes(input.requester.relationship), scope.roles.includes(input.requester.role)];
  const restricted = [scope.legalEntityIds, scope.baseIds, scope.relationships, scope.roles]
    .filter((values) => !values.includes("*")).length;
  return matches.filter(Boolean).length * 0.12 + restricted * 0.18;
}

function rankEligible(candidates: RetrievalCandidate[], input: DecideRequest, requirement: AnswerRequirement): RetrievalCandidate[] {
  return candidates.map((candidate) => {
    const authorityScore = candidate.document.authorityTier / 100 * 1.2;
    const scopeScore = scopeSpecificity(candidate, input);
    const sufficiencyScore = sufficiency(candidate, requirement);
    return { ...candidate, authorityScore, scopeScore, sufficiencyScore, finalScore: candidate.score + authorityScore + scopeScore + sufficiencyScore };
  }).sort((left, right) => (right.finalScore ?? 0) - (left.finalScore ?? 0) || right.score - left.score);
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
  if (codes.has("future") || codes.has("expired") || codes.has("superseded")) return "missing_source";
  if (codes.has("sensitivity") || codes.has("audience")) return "policy_sensitive_source";
  if (codes.has("scope")) return "profile_mismatch";
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

function selectAnswerCandidates(
  eligible: RetrievalCandidate[],
  question: string,
  requirement: AnswerRequirement,
): RetrievalCandidate[] {
  const strongest = uniqueSourceCandidates(eligible.filter((candidate) => (candidate.sufficiencyScore ?? -1) > 0));
  const top = strongest[0];
  const coverageFloor = requirement === "general_rule" ? 0.52 : 0;
  if (!top || top.score < MIN_RELEVANCE || top.queryCoverage < coverageFloor) return [];
  const selected = [top];
  const asksCompound = /\b(?:e|também|tambem|além disso|alem disso)\b/iu.test(question);
  if (asksCompound) {
    const second = strongest.find((candidate) =>
      candidate.document.sourceId !== top.document.sourceId &&
      (candidate.finalScore ?? candidate.score) >= Math.max(MIN_RELEVANCE, (top.finalScore ?? top.score) * 0.34) &&
      candidate.queryCoverage >= 0.25 &&
      candidate.passage.answerText !== top.passage.answerText);
    if (second) selected.push(second);
  }
  return selected;
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
  retrieval: { queryTokens: string[]; expandedTerms?: string[]; concepts?: string[]; explicitRegion?: string; resolvedRegion?: string; requirement?: string },
  confidence: EvidenceConfidence,
  timings: { retrieval: number; governance: number; decision: number; total: number },
): void {
  const uniqueEligible = uniqueSourceCandidates(eligible);
  const rejectionReasons: Record<string, number> = {};
  for (const item of rejected) {
    const reason = primaryRejection(item.rejectionCodes);
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }
  const trace: DecisionTrace = {
    traceId,
    requestId: input.requestId,
    createdAt: new Date().toISOString(),
    decisionKind: decision.kind,
    pipelineVersion: PIPELINE_VERSION,
    indexVersion: "bm25-memory-v1",
    stages: ["retrieval", "governance", "decision"],
    governance: {
      candidateCount: candidates.length,
      eligibleCount: uniqueEligible.length,
      rejectedCount: rejected.length,
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
    provider: { status: "not_used" },
    consideredEvidence: candidates.map((candidate, index) => ({
      sourceId: candidate.document.sourceId,
      versionId: candidate.document.versionId,
      startByte: candidate.passage.startByte,
      endByte: candidate.passage.endByte,
      rank: index + 1,
      stage: eligible.some((item) => item.passage.id === candidate.passage.id)
        ? "eligible"
        : "rejected",
      score: Number(candidate.score.toFixed(4)),
      passageId: candidate.passage.id,
      lexicalScore: Number(candidate.score.toFixed(4)),
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

  if (matchesAny(input.question, CONVERSATIONAL_PATTERNS)) {
    const decision: Decision = {
      kind: "conversational",
      body: "Olá! Posso orientar sobre políticas e processos de People Operations ou encaminhar o atendimento para uma pessoa.",
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
  if (!asksPolicyCapability && matchesAny(input.question, SENSITIVE_PATTERNS)) {
    const reason: HandoffReason = "sensitive_topic";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The request concerns individual or protected state."));
    return deferredDecision(input, traceId, reason, 0.05);
  }

  const documents = loadSourceDocuments();
  const retrievalStarted = performance.now();
  const retrieval = lexicalIndex(documents).search(input.question);
  const retrievalMs = performance.now() - retrievalStarted;
  const topScore = retrieval.candidates[0]?.score ?? 0;
  const relevanceFloor = Math.max(0.55, topScore * 0.12);
  // Govern passages first: a later clause in the same source can be the only sufficient answer.
  const requestedRegion = explicitRegion(input.question);
  const resolvedRegion = requestedRegion ?? input.requester.baseId;
  const candidates = retrieval.candidates
    .filter((candidate) => sourceMatchesRequestedRegion(candidate, requestedRegion))
    .filter((candidate) => candidate.score >= relevanceFloor)
    .slice(0, MAX_GOVERNED_CANDIDATES);

  const governanceStarted = performance.now();
  const scopedInput = requestedRegion ? { ...input, requester: { ...input.requester, baseId: requestedRegion } } : input;
  const superseded = activeSupersededSources(documents, scopedInput);
  const eligible: RetrievalCandidate[] = [];
  const rejected: Array<{ candidate: RetrievalCandidate; rejectionCodes: EligibilityRejectionCode[] }> = [];
  for (const candidate of candidates) {
    const result = evaluateEligibility(candidate.document, scopedInput, superseded);
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
  const rankedEligible = rankEligible(eligible, scopedInput, requirement);
  const conflictCandidates = rankedEligible.filter((candidate) =>
    (candidate.sufficiencyScore ?? 0) > 0 && candidate.score >= topScore * 0.45);
  const conflicts = detectConflicts(conflictCandidates);
  const governanceMs = performance.now() - governanceStarted;

  const decisionStarted = performance.now();
  let decision: Decision;
  let confidence: EvidenceConfidence;
  if (candidates.length === 0 || topScore < MIN_RELEVANCE) {
    decision = deferredDecision(input, traceId, "missing_source", 0.08);
  } else if (eligible.length === 0) {
    decision = deferredDecision(input, traceId, deferReasonForRejected(rejected), 0.12, rejected);
  } else if (conflicts.length > 0) {
    decision = deferredDecision(input, traceId, "conflicting_source", 0.2);
  } else {
    const answerCandidates = selectAnswerCandidates(rankedEligible, input.question, requirement);
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
  confidence = evidenceConfidence(decision, selectedForConfidence, conflicts, requestedRegion);
  if (decision.kind === "answer") {
    decision.claims = decision.claims.map((claim) => ({ ...claim, confidence }));
  }
  const decisionMs = performance.now() - decisionStarted;
  saveRoutingTrace(input, traceId, decision, candidates, rankedEligible, rejected, conflicts,
    { queryTokens: retrieval.queryTokens, expandedTerms: retrieval.expandedTerms, concepts: retrieval.concepts,
      explicitRegion: requestedRegion, resolvedRegion, requirement }, confidence,
    { retrieval: retrievalMs, governance: governanceMs, decision: decisionMs, total: performance.now() - started });
  return decision;
}
