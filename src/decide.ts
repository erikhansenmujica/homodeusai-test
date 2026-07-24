import { createHash } from "node:crypto";
import {
  answerRequirement,
  rankEligible,
  retrievalStrength,
  selectAnswerCandidates,
  selectCompoundAnswerCandidates,
} from "./answer-support.ts";
import {
  retrievalQuestionFor,
  routingIntentIsContextual,
  routingIntentIsTerminal,
} from "./conversation.ts";
import { loadSourceDocuments } from "./corpus.ts";
import { RETRIEVAL_LIMITS } from "./domain-config.ts";
import { evidenceForQuote } from "./evidence.ts";
import { activeSupersededSources, detectConflicts, evaluateEligibility } from "./governance.ts";
import { createHandoff } from "./queue.ts";
import { lexicalIndex, tokenize } from "./retrieval.ts";
import { semanticPatternConfig } from "./semantic-patterns.ts";
import {
  runtimeAnswerAlignment,
  runtimeAnswerPatterns,
  runtimeCandidateAnswerPatterns,
  runtimeCompositionPatterns,
  runtimeRetrievalPatterns,
  runtimeRoutingPatterns,
  runtimeSemanticSearch,
} from "./runtime.ts";
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
  SourceDocument,
} from "./types.ts";

const PIPELINE_VERSION = "semantic-governed-v4";
const MIN_RELEVANCE = RETRIEVAL_LIMITS.minimumRelevance;
const MAX_GOVERNED_CANDIDATES = RETRIEVAL_LIMITS.maximumGovernedCandidates;


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

function explicitRegion(question: string, documents: SourceDocument[]): string | undefined {
  const questionTokens = new Set(tokenize(question));
  const titleTokensByBase = new Map<string, Set<string>>();
  for (const document of documents) {
    const bases = document.eligibility.baseIds.filter((baseId) => baseId !== "*");
    if (bases.length !== 1) continue;
    const tokens = titleTokensByBase.get(bases[0]!) ?? new Set<string>();
    tokenize(`${bases[0]!.replaceAll("_", " ")} ${document.title}`)
      .filter((token) => token.length >= 3)
      .forEach((token) => tokens.add(token));
    titleTokensByBase.set(bases[0]!, tokens);
  }
  const ownership = new Map<string, Set<string>>();
  for (const [baseId, tokens] of titleTokensByBase) {
    for (const token of tokens) {
      const bases = ownership.get(token) ?? new Set<string>();
      bases.add(baseId);
      ownership.set(token, bases);
    }
  }
  const matches = [...titleTokensByBase].filter(([baseId, tokens]) =>
    [...tokens].some((token) => questionTokens.has(token) && ownership.get(token)?.size === 1
      && ownership.get(token)?.has(baseId)));
  return matches.length === 1 ? matches[0]![0] : undefined;
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

function containsEmbeddedStructuredPayload(value: string): boolean {
  return /(?:^|\n)[\p{Lu}\p{N}_-]{8,}:/u.test(value);
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
  const scoredEligible = new Map(eligible.map((candidate) => [candidate.passage.id, candidate]));
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
    consideredEvidence: candidates.map((candidate, index) => {
      const scored = scoredEligible.get(candidate.passage.id) ?? candidate;
      return {
      sourceId: scored.document.sourceId,
      versionId: scored.document.versionId,
      startByte: scored.passage.startByte,
      endByte: scored.passage.endByte,
      rank: index + 1,
      stage: scoredEligible.has(candidate.passage.id)
        ? "eligible"
        : "rejected",
      score: Number(retrievalStrength(scored).toFixed(4)),
      passageId: scored.passage.id,
      lexicalScore: scored.lexicalScore === undefined ? undefined : Number(scored.lexicalScore.toFixed(4)),
      semanticScore: scored.semanticScore === undefined ? undefined : Number(scored.semanticScore.toFixed(4)),
      answerSemanticScore: scored.answerSemanticScore === undefined
        ? undefined
        : Number(scored.answerSemanticScore.toFixed(4)),
      fusionScore: scored.fusionScore === undefined ? undefined : Number(scored.fusionScore.toFixed(6)),
      finalScore: scored.finalScore === undefined ? undefined : Number(scored.finalScore.toFixed(4)),
      rejectionCodes: rejected.find((item) => item.candidate.passage.id === candidate.passage.id)?.rejectionCodes,
      selectedAsEvidence: decision.kind === "answer" && decision.claims.some((claim) => claim.evidence.some((evidence) =>
        evidence.sourceId === scored.document.sourceId && scored.passage.text.includes(evidence.quote))),
    }}),
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
  const [[routing], [queryPattern], [initialRetrievalPattern], [composition]] = await Promise.all([
    runtimeRoutingPatterns([input.question]),
    runtimeAnswerPatterns([input.question]),
    runtimeRetrievalPatterns([input.question]),
    runtimeCompositionPatterns([input.question]),
  ]);
  const retrievalContext = await retrievalQuestionFor(input, routing!, runtimeRoutingPatterns);
  const contextualRetrievalPatterns = retrievalContext.usedHistory
    ? await runtimeRetrievalPatterns([retrievalContext.question, ...retrievalContext.topicQuestions])
    : [];
  const retrievalPattern = contextualRetrievalPatterns.length > 0
    ? contextualRetrievalPatterns.sort((left, right) =>
      (right.best.score - right.second.score) - (left.best.score - left.second.score)
      || right.best.score - left.best.score)[0]!
    : initialRetrievalPattern!;
  const patternThresholds = semanticPatternConfig().thresholds;
  const initialDomainSignal = initialRetrievalPattern!.best.score
    >= patternThresholds.routingDomainSignalMinimum
    && initialRetrievalPattern!.best.score - initialRetrievalPattern!.second.score
      >= patternThresholds.retrievalConceptMargin;
  const compoundQuestion = composition!.best.id === "compound_question"
    && composition!.best.score >= patternThresholds.compositionMinimum
    && composition!.best.score - composition!.second.score >= patternThresholds.compositionMargin;
  const retrievalDefinitions = semanticPatternConfig().retrievalPatterns;
  const selectedRetrievalId = retrievalPattern.best.id;
  const selectedRetrievalScore = retrievalPattern.scores[selectedRetrievalId] ?? 0;
  const selectedRetrievalDefinition = retrievalDefinitions.find((pattern) =>
    pattern.id === selectedRetrievalId);
  const answerPatternCompatible = retrievalContext.usedHistory
    || selectedRetrievalDefinition?.answerPattern === undefined
    || selectedRetrievalDefinition.answerPattern === queryPattern!.best.id
    || selectedRetrievalDefinition.answerPatternFlexible === true
    || (
      selectedRetrievalScore >= patternThresholds.answerSemanticMinimum
      && retrievalPattern.best.score - retrievalPattern.second.score
        >= patternThresholds.answerPatternMargin
    );
  const useRetrievalPattern = !compoundQuestion
    && selectedRetrievalScore >= patternThresholds.retrievalConceptMinimum
    && retrievalPattern.best.score - retrievalPattern.second.score >= patternThresholds.retrievalConceptMargin
    && answerPatternCompatible;
  const retrievalDefinition = useRetrievalPattern
    ? selectedRetrievalDefinition
    : undefined;
  const retrievalHint = retrievalDefinition?.retrievalHint;
  const expectedPattern = retrievalDefinition?.answerPattern;
  const preferredSourceTypes = retrievalDefinition?.preferredSourceTypes ?? [];
  const requiredSourceTypes = retrievalDefinition?.requiredSourceTypes ?? [];

  if (!compoundQuestion
    && (routingIntentIsTerminal(routing!, "gratitude") || routingIntentIsTerminal(routing!, "greeting"))) {
    const decision: Decision = {
      kind: "conversational",
      body: routing!.best.id === "gratitude"
        ? "De nada. Estou à disposição para outras dúvidas sobre People Operations."
        : "Olá! Posso orientar sobre políticas e processos de People Operations ou encaminhar o atendimento para uma pessoa.",
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started,
      `Semantic route: ${routing!.best.id}. No policy decision was requested.`));
    return decision;
  }

  if (routingIntentIsTerminal(routing!, "human_requested")) {
    const reason: HandoffReason = "human_requested";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The requester explicitly asked for a person."));
    return deferredDecision(input, traceId, reason, 0);
  }

  if (routingIntentIsTerminal(routing!, "governance_attack")) {
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

  if (
    !compoundQuestion
    &&
    !initialDomainSignal
    &&
    routingIntentIsTerminal(routing!, "out_of_scope")
  ) {
    const decision: Decision = {
      kind: "conversational",
      body: "Este atendimento é limitado a políticas e processos de People Operations. Posso ajudar com uma dúvida desse contexto.",
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started, "The question is outside the People Operations scope."));
    return decision;
  }

  if (compoundQuestion && !initialDomainSignal && routingIntentIsTerminal(routing!, "out_of_scope")) {
    const reason: HandoffReason = "missing_source";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started,
      "At least one independent part of the compound question is outside the governed People Operations corpus."));
    return deferredDecision(input, traceId, reason, 0.08);
  }

  if (retrievalDefinition?.knownCorpusGap === true) {
    const reason: HandoffReason = "missing_source";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started,
      "A versioned semantic concept identifies a known gap in the governed corpus."));
    return deferredDecision(input, traceId, reason, 0.08);
  }

  const liveStateDefinition = semanticPatternConfig().routingPatterns.find((pattern) =>
    pattern.id === "live_individual_state");
  const liveStateSupported = routing!.best.id === "live_individual_state"
    && (routing!.scores.live_individual_state ?? 0)
      >= (liveStateDefinition?.terminalMinimum ?? patternThresholds.terminalIntentMinimum);
  const individualStateSupported = queryPattern!.best.id === "individual_state";
  if ((retrievalDefinition?.sensitiveTopic === true || (liveStateSupported && individualStateSupported))
    && retrievalDefinition?.liveStateOverride !== true) {
    const reason: HandoffReason = "sensitive_topic";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The request requires live individual transactional state, which static governed sources do not provide."));
    return deferredDecision(input, traceId, reason, 0.96);
  }

  const contextFreeConcept = retrievalDefinition?.contextFreeMinimum !== undefined
    && selectedRetrievalScore >= retrievalDefinition.contextFreeMinimum;
  if (routingIntentIsContextual(routing!) && !retrievalContext.usedHistory && !contextFreeConcept) {
    const decision: Decision = {
      kind: "conversational",
      body: "Posso responder a pergunta complementar quando houver uma decisão anterior no mesmo contexto. Faça primeiro a pergunta principal de People Operations.",
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started,
      "A referential follow-up had no completed user question establishing a trusted topic."));
    return decision;
  }

  const documents = loadSourceDocuments();
  const retrievalStarted = performance.now();
  const retrieval = lexicalIndex(documents).search(retrievalContext.question, 192);
  const semanticQuestion = retrievalHint ?? retrievalContext.question;
  const semantic = await runtimeSemanticSearch(documents, semanticQuestion, 192);
  const semanticProviderStatus = semantic.mode === "learned" ? "ok" : "degraded";
  const hybridCandidates = fuseRetrieval(retrieval.candidates, semantic.candidates, 256);
  const retrievalMs = performance.now() - retrievalStarted;
  const topScore = hybridCandidates.reduce((strongest, candidate) =>
    Math.max(strongest, retrievalStrength(candidate)), 0);
  const relevanceFloor = Math.max(0.55, topScore * 0.12);
  // Govern passages first: a later clause in the same source can be the only sufficient answer.
  const requestedRegion = explicitRegion(input.question, documents);
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
  const [answerAlignments, passageAnalyses] = await Promise.all([
    runtimeAnswerAlignment(documents, retrievalContext.question, eligible),
    runtimeCandidateAnswerPatterns(documents, eligible),
  ]);
  const passagePatterns = new Map(eligible.map((candidate, index) =>
    [candidate.passage.id, passageAnalyses[index]!] as const));
  const alignedEligible = eligible.map((candidate, index) => ({
    ...candidate,
    answerSemanticScore: answerAlignments[index],
  }));
  const topAnswerSemanticScore = alignedEligible.reduce((top, candidate) =>
    Math.max(top, candidate.answerSemanticScore ?? 0), 0);
  const semanticEligible = alignedEligible
    .filter((candidate) => candidate.semanticScore !== undefined)
    .map((candidate) => ({ ...candidate, semanticScore: candidate.semanticScore! }))
    .sort((left, right) => right.semanticScore - left.semanticScore);
  const semanticScores = semanticEligible.map((candidate) => candidate.semanticScore);
  const semanticWindow = semanticPatternConfig().thresholds.semanticWindow;
  const nearTopSemantic = semanticEligible.filter((candidate) =>
    candidate.semanticScore >= (semanticScores[0] ?? 0) - semanticWindow);
  const topSemanticSourceId = semanticEligible[0]?.document.sourceId;
  const topSemanticSourceCount = nearTopSemantic.filter((candidate) =>
    candidate.document.sourceId === topSemanticSourceId).length;
  const supportContext = {
    queryPattern: queryPattern!,
    passagePatterns,
    topSemanticScore: semanticScores[0] ?? 0,
    secondSemanticScore: semanticScores[1] ?? 0,
    topSemanticSourceId,
    topSemanticSourceShare: topSemanticSourceCount / Math.max(1, nearTopSemantic.length),
    topAnswerSemanticScore,
    answerSemanticMinimum: retrievalDefinition?.answerAlignmentMinimum
      ?? patternThresholds.answerSemanticMinimum,
    expectedPattern,
    preferredSourceTypes,
    learned: semantic.mode === "learned",
  };
  const requirement = expectedPattern ?? answerRequirement(queryPattern!);
  const answerEligible = requiredSourceTypes.length > 0
    ? alignedEligible.filter((candidate) => requiredSourceTypes.includes(candidate.document.sourceType))
    : alignedEligible;
  const rankedEligible = rankEligible(answerEligible, input, requirement, supportContext);
  const conflictDomain = retrievalDefinition
    ? rankedEligible.find((candidate) => (candidate.sufficiencyScore ?? 0) > 0)?.document.domain
    : undefined;
  const strongestEligible = rankedEligible.reduce((strongest, candidate) =>
    Math.max(strongest, retrievalStrength(candidate)), 0);
  const conflictAnswerWindow = patternThresholds.multiPassageWindow * 1.6;
  const conflictCandidates = rankedEligible.filter((candidate) =>
    (conflictDomain === undefined || candidate.document.domain === conflictDomain)
    &&
    (
      candidate.queryCoverage >= patternThresholds.lexicalCoverageMinimum
      || (candidate.answerSemanticScore ?? 0) >= topAnswerSemanticScore - conflictAnswerWindow
    )
    && (
      expectedPattern === undefined
      || (() => {
        const analysis = passagePatterns.get(candidate.passage.id);
        return analysis !== undefined
          && (analysis.scores[requirement] ?? 0)
            >= analysis.best.score - patternThresholds.answerPatternMargin;
      })()
    )
    && (
      expectedPattern === undefined
      || candidate.semanticScore === undefined
      || candidate.semanticScore >= supportContext.topSemanticScore
        - patternThresholds.semanticWindow * (retrievalDefinition?.conflictWindowMultiplier ?? 1)
    )
    && retrievalStrength(candidate) >= strongestEligible * 0.45);
  const hasSufficientCandidate = rankedEligible.some((candidate) =>
    (candidate.sufficiencyScore ?? 0) > 0);
  const conflicts = hasSufficientCandidate ? detectConflicts(conflictCandidates) : [];
  if (semantic.mode === "degraded") {
    const topLexicalScore = alignedEligible.reduce((top, candidate) =>
      Math.max(top, candidate.lexicalScore ?? 0), 0);
    const degradedConflictCandidates = alignedEligible.filter((candidate) =>
      (candidate.lexicalScore ?? 0) >= topLexicalScore * 0.45
      && candidate.queryCoverage >= 0.2);
    const knownPairs = new Set(conflicts.map((conflict) =>
      [conflict.left.document.sourceId, conflict.right.document.sourceId].sort().join("\n")));
    for (const conflict of detectConflicts(degradedConflictCandidates)) {
      const pair = [conflict.left.document.sourceId, conflict.right.document.sourceId].sort().join("\n");
      if (!knownPairs.has(pair)) {
        knownPairs.add(pair);
        conflicts.push(conflict);
      }
    }
  }
  if (retrievalDefinition?.id === "admission_submission_channel") {
    const bySource = new Map(rankedEligible
      .filter((item) => (item.sufficiencyScore ?? 0) > 0)
      .map((candidate) => [candidate.document.sourceId, candidate]));
    const values = [...bySource.values()];
    if (values.length > 1) {
      conflicts.push({
        domain: "submission_channel",
        left: values[0]!,
        right: values[1]!,
        signals: ["multiple_authoritative_destinations"],
      });
    }
  }
  const governanceMs = performance.now() - governanceStarted;
  const regionProfileMismatch = requestedRegion !== undefined &&
    requestedRegion !== input.requester.baseId &&
    rejected.some((item) => item.rejectionCodes.includes("scope"));
  const topRelevantSemantic = candidates.reduce((top, candidate) =>
    Math.max(top, candidate.semanticScore ?? 0), 0);
  const applicableExpiredSource = rejected.some((item) =>
    item.rejectionCodes.includes("expired")
    && !item.rejectionCodes.some((code) =>
      ["approval", "audience", "sensitivity", "scope", "future"].includes(code))
    && (
      preferredSourceTypes.length === 0
      || preferredSourceTypes.includes(item.candidate.document.sourceType)
    )
    && (
      item.candidate.queryCoverage >= patternThresholds.lexicalCoverageMinimum
      || (item.candidate.semanticScore ?? 0) >= topRelevantSemantic - patternThresholds.semanticWindow
    ));

  const decisionStarted = performance.now();
  let decision: Decision;
  let confidence: EvidenceConfidence;
  if (candidates.length === 0 || topScore < MIN_RELEVANCE) {
    decision = deferredDecision(input, traceId, "missing_source", 0.08);
  } else if (regionProfileMismatch) {
    decision = deferredDecision(input, traceId, "profile_mismatch", 0.12, rejected);
  } else if (applicableExpiredSource) {
    decision = deferredDecision(input, traceId, "missing_source", 0.12, rejected);
  } else if (eligible.length === 0) {
    decision = deferredDecision(input, traceId, deferReasonForRejected(rejected), 0.12, rejected);
  } else if (conflicts.length > 0) {
    decision = deferredDecision(input, traceId, "conflicting_source", 0.2);
  } else {
    const answerCandidates = compoundQuestion
      ? selectCompoundAnswerCandidates(rankedEligible, supportContext)
      : selectAnswerCandidates(rankedEligible, requirement, supportContext);
    if (answerCandidates.length === 0) {
      decision = deferredDecision(input, traceId, "missing_source", 0.18, rejected);
    } else if (
      semantic.mode === "degraded"
      && answerCandidates.some((candidate) =>
        candidate.queryCoverage < 0.8
        || containsEmbeddedStructuredPayload(candidate.passage.answerText))
    ) {
      decision = deferredDecision(input, traceId, "low_confidence", 0.18, rejected);
    } else {
      const claims = createClaims(answerCandidates);
      decision = {
        kind: "answer",
        answerabilityScore: Math.min(0.96, 0.62 + topScore / 40),
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
    { queryTokens: retrieval.queryTokens, expandedTerms: [], concepts: [
      routing!.best.id,
      queryPattern!.best.id,
      ...(useRetrievalPattern ? [selectedRetrievalId] : []),
      ...(compoundQuestion ? ["compound_question"] : []),
    ],
      explicitRegion: requestedRegion, resolvedRegion, requirement, providerStatus: semanticProviderStatus,
      contextualized: retrievalContext.usedHistory, contextualTurns: retrievalContext.contextualTurns }, confidence,
    { retrieval: retrievalMs, governance: governanceMs, decision: decisionMs, total: performance.now() - started });
  return decision;
}
