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
  routingIntentIsSupported,
  routingIntentIsTerminal,
} from "./conversation.ts";
import { loadSourceDocuments } from "./corpus.ts";
import { RETRIEVAL_LIMITS } from "./domain-config.ts";
import { evidenceForQuote } from "./evidence.ts";
import { activeSupersededSources, detectConflicts, evaluateEligibility } from "./governance.ts";
import { createHandoff } from "./queue.ts";
import { lexicalIndex, tokenize } from "./retrieval.ts";
import {
  mergeSemanticPatternAnalyses,
  semanticPatternConfig,
  type AnswerPattern,
} from "./semantic-patterns.ts";
import {
  runtimeAnswerAlignment,
  runtimePromptAlignment,
  runtimeAnswerPatterns,
  runtimeCandidateAnswerPatterns,
  runtimeCompositionPatterns,
  runtimeRetrievalPatterns,
  runtimeRoutingPatterns,
  runtimeSemanticSearchMany,
  SemanticProviderUnavailableError,
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

function semanticSentences(value: string): string[] {
  const segments = [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(value)]
    .map((segment) => segment.segment.trim())
    .filter((segment) => segment.length > 0 && segment !== value.trim());
  return [...new Set(segments)];
}

async function hasMixedScopeClauseBoundary(question: string): Promise<boolean> {
  const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(question)]
    .filter((segment) => segment.isWordLike);
  if (words.length < 6) return false;
  const allOffsets = words.slice(3, -2).map((word) => word.index);
  const maximumBoundaries = 24;
  const offsets = allOffsets.length <= maximumBoundaries
    ? allOffsets
    : [...new Set(Array.from({ length: maximumBoundaries }, (_value, index) =>
      allOffsets[Math.round(index * (allOffsets.length - 1) / (maximumBoundaries - 1))]!))];
  const clauses = offsets.flatMap((offset) => [
    question.slice(0, offset).trim(),
    question.slice(offset).trim(),
  ]);
  const [routing, retrieval] = await Promise.all([
    runtimeRoutingPatterns(clauses),
    runtimeRetrievalPatterns(clauses),
  ]);
  const thresholds = semanticPatternConfig().thresholds;
  const isUnsupportedOutsideClause = (
    route: (typeof routing)[number],
    concept: (typeof retrieval)[number],
  ): boolean =>
    routingIntentIsTerminal(route, "out_of_scope")
    && (route.scores.out_of_scope ?? 0) >= concept.best.score + thresholds.semanticWindow;
  const isSupportedPolicyClause = (concept: (typeof retrieval)[number]): boolean =>
    concept.best.score >= thresholds.routingDomainSignalMinimum
    && concept.best.score - concept.second.score >= thresholds.retrievalConceptMargin;
  for (let index = 0; index < offsets.length; index += 1) {
    const leftRouting = routing[index * 2]!;
    const rightRouting = routing[index * 2 + 1]!;
    const leftRetrieval = retrieval[index * 2]!;
    const rightRetrieval = retrieval[index * 2 + 1]!;
    if (
      (
        isUnsupportedOutsideClause(leftRouting, leftRetrieval)
        && isSupportedPolicyClause(rightRetrieval)
      )
      || (
        isUnsupportedOutsideClause(rightRouting, rightRetrieval)
        && isSupportedPolicyClause(leftRetrieval)
      )
    ) return true;
  }
  return false;
}

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
  const regionTokensByBase = new Map<string, { base: Set<string>; title: Set<string> }>();
  for (const document of documents) {
    const bases = document.eligibility.baseIds.filter((baseId) => baseId !== "*");
    if (bases.length !== 1) continue;
    const tokens = regionTokensByBase.get(bases[0]!) ?? {
      base: new Set(tokenize(bases[0]!.replaceAll("_", " ")).filter((token) => token.length >= 3)),
      title: new Set<string>(),
    };
    tokenize(document.title)
      .filter((token) => token.length >= 3)
      .forEach((token) => tokens.title.add(token));
    regionTokensByBase.set(bases[0]!, tokens);
  }
  const ownership = new Map<string, Set<string>>();
  for (const [baseId, groups] of regionTokensByBase) {
    for (const token of [...groups.base, ...groups.title]) {
      const bases = ownership.get(token) ?? new Set<string>();
      bases.add(baseId);
      ownership.set(token, bases);
    }
  }
  const matches = [...regionTokensByBase].filter(([baseId, groups]) => {
    const baseMatch = groups.base.size > 0
      && [...groups.base].every((token) => questionTokens.has(token));
    const distinctTitleMatches = [...groups.title].filter((token) =>
      questionTokens.has(token)
      && ownership.get(token)?.size === 1
      && ownership.get(token)?.has(baseId));
    return baseMatch || distinctTitleMatches.length >= 2;
  });
  return matches.length === 1 ? matches[0]![0] : undefined;
}

function sourceMatchesRequestedRegion(
  candidate: Pick<RetrievalCandidate, "document">,
  baseId: string | undefined,
): boolean {
  return !baseId || candidate.document.eligibility.baseIds.includes("*") || candidate.document.eligibility.baseIds.includes(baseId);
}

function sourceHasRelationshipOnlyGap(
  candidate: RetrievalCandidate,
  input: DecideRequest,
): boolean {
  const scope = candidate.document.eligibility;
  const matches = (values: string[], actual: string): boolean =>
    values.length === 0 || values.includes("*") || values.includes(actual);
  return matches(scope.legalEntityIds, input.requester.legalEntityId)
    && matches(scope.baseIds, input.requester.baseId)
    && matches(scope.roles, input.requester.role)
    && !matches(scope.relationships, input.requester.relationship);
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
  // Report the trusted-profile mismatch when every relevant source rejects that same profile.
  const uniformlyOutOfProfile = candidates.length > 0
    && candidates.every((item) => item.rejectionCodes.includes("scope"));
  if (uniformlyOutOfProfile) return "profile_mismatch";
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
  providerStatus: DecisionTrace["provider"]["status"] = "not_used",
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
    provider: { status: providerStatus },
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

// Serialize classifier outputs as bounded numeric diagnostics rather than opaque internal reasoning.
function traceClassifier(analysis: {
  best: { id: string; score: number };
  second: { id: string; score: number };
  scores: Record<string, number>;
}): {
  best: { id: string; score: number };
  second: { id: string; score: number };
  scores: Record<string, number>;
} {
  return {
    best: { id: analysis.best.id, score: Number(analysis.best.score.toFixed(4)) },
    second: { id: analysis.second.id, score: Number(analysis.second.score.toFixed(4)) },
    scores: Object.fromEntries(Object.entries(analysis.scores)
      .map(([id, score]) => [id, Number(score.toFixed(4))])),
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
    // Carry the same public classifier diagnostics through every persisted routing trace.
    classifierScores?: NonNullable<DecisionTrace["retrievalDiagnostics"]>["classifierScores"];
    note?: string;
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
      promptSemanticScore: scored.promptSemanticScore === undefined
        ? undefined
        : Number(scored.promptSemanticScore.toFixed(4)),
      fusionScore: scored.fusionScore === undefined ? undefined : Number(scored.fusionScore.toFixed(6)),
      finalScore: scored.finalScore === undefined ? undefined : Number(scored.finalScore.toFixed(4)),
      queryCoverage: Number(scored.queryCoverage.toFixed(4)),
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
      ...(retrieval.note ? [retrieval.note] : []),
    ],
    retrievalDiagnostics: {
      queryTokens: retrieval.queryTokens,
      expandedTerms: retrieval.expandedTerms ?? [],
      concepts: retrieval.concepts ?? [],
      explicitRegion: retrieval.explicitRegion,
      resolvedRegion: retrieval.resolvedRegion,
      answerRequirement: retrieval.requirement,
      classifierScores: retrieval.classifierScores,
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

async function decideGoverned(input: DecideRequest): Promise<Decision> {
  const started = performance.now();
  const traceId = traceIdFor(input);
  const sentenceSegments = semanticSentences(input.question);
  const routingInputs = [input.question, ...sentenceSegments];
  const routingAnalyses = await runtimeRoutingPatterns(routingInputs);
  const routing = mergeSemanticPatternAnalyses(routingAnalyses);
  const trustedSemanticSegments = sentenceSegments.filter((_segment, index) =>
    !routingIntentIsSupported(routingAnalyses[index + 1]!, "requester_context_override"));
  const semanticInputQuestion = trustedSemanticSegments.length > 0
    && trustedSemanticSegments.length < sentenceSegments.length
    ? trustedSemanticSegments.join(" ")
    : input.question;
  const [[queryPattern], [initialRetrievalPattern], [composition]] = await Promise.all([
    runtimeAnswerPatterns([semanticInputQuestion]),
    runtimeRetrievalPatterns([semanticInputQuestion]),
    runtimeCompositionPatterns([semanticInputQuestion]),
  ]);
  const retrievalContext = await retrievalQuestionFor(
    { ...input, question: semanticInputQuestion },
    routing,
    runtimeRoutingPatterns,
  );
  const contextualRetrievalPatterns = retrievalContext.usedHistory
    ? await runtimeRetrievalPatterns([retrievalContext.question, ...retrievalContext.topicQuestions])
    : [];
  const retrievalPattern = contextualRetrievalPatterns.length > 0
    ? contextualRetrievalPatterns.sort((left, right) =>
      (right.best.score - right.second.score) - (left.best.score - left.second.score)
      || right.best.score - left.best.score)[0]!
    : initialRetrievalPattern!;
  const patternThresholds = semanticPatternConfig().thresholds;
  // Capture every semantic classifier result once so all exit paths can persist the same diagnostics.
  const classifierScores = {
    routing: traceClassifier(routing),
    retrieval: traceClassifier(retrievalPattern),
    answer: traceClassifier(queryPattern!),
    composition: traceClassifier(composition!),
  };
  const initialDomainSignal = initialRetrievalPattern!.best.score
    >= patternThresholds.routingDomainSignalMinimum
    && initialRetrievalPattern!.best.score - initialRetrievalPattern!.second.score
      >= patternThresholds.retrievalConceptMargin;
  const compositionSignal = composition!.best.id === "compound_question"
    && composition!.best.score >= patternThresholds.compositionMinimum
    && composition!.best.score - composition!.second.score >= patternThresholds.compositionMargin;
  const mixedScopeCompositionSignal = composition!.best.id === "compound_question"
    && composition!.best.score - composition!.second.score >= patternThresholds.compositionMargin;
  const retrievalDefinitions = semanticPatternConfig().retrievalPatterns;
  // Accept a concept only when the classified response shape is one of its governed shapes.
  const answerPatternCompatible = (definition: typeof retrievalDefinitions[number]): boolean =>
    retrievalContext.usedHistory
    || definition.answerPattern === undefined
    || definition.answerPatternFlexible === true
    || (definition.compatibleAnswerPatterns ?? [definition.answerPattern])
      .some((answerPattern) =>
        (queryPattern!.scores[answerPattern] ?? 0)
          >= queryPattern!.best.score - (
            definition.answerPatternMargin
            ?? patternThresholds.answerPatternMargin
          ));
  const compatibleRetrievalPatterns = retrievalDefinitions
    .map((definition) => ({
      definition,
      score: retrievalPattern.scores[definition.id] ?? 0,
      selectionScore: (retrievalPattern.scores[definition.id] ?? 0)
        + (
          definition.answerPattern === undefined
            ? 0
            : (
              (queryPattern!.scores[definition.answerPattern as AnswerPattern] ?? 0)
                - queryPattern!.best.score
            ) * (
              definition.answerPatternSelectionWeight
              ?? patternThresholds.answerPatternSelectionWeight
            )
        )
        + (
          definition.profileAffinityRelationships?.includes(input.requester.relationship)
            ? patternThresholds.profileConceptBoost
            : 0
        ),
    }))
    .filter((candidate) =>
      candidate.score >= (candidate.definition.minimumScore
        ?? patternThresholds.retrievalConceptMinimum)
      && candidate.score
        + (
          candidate.definition.profileAffinityRelationships?.includes(input.requester.relationship)
            ? patternThresholds.profileConceptBoost
            : 0
        )
        >= retrievalPattern.best.score - patternThresholds.semanticWindow
      && answerPatternCompatible(candidate.definition))
    .sort((left, right) => right.selectionScore - left.selectionScore
      || right.score - left.score
      || left.definition.id.localeCompare(right.definition.id));
  const selectedRetrievalPattern = compatibleRetrievalPatterns[0];
  const nextCompatibleScore = compatibleRetrievalPatterns[1]?.selectionScore ?? 0;
  // Let a best-match policy override resolve live-state ambiguity when it clears its concept margin.
  const useRetrievalPattern = selectedRetrievalPattern !== undefined
    && (
      selectedRetrievalPattern.selectionScore - nextCompatibleScore >= (
        selectedRetrievalPattern.definition.minimumMargin
        ?? patternThresholds.safetyBoundaryMargin
      )
      || compatibleRetrievalPatterns.length === 1
      || (
        selectedRetrievalPattern.definition.policyGuidanceOverride === true
        && selectedRetrievalPattern.definition.id === retrievalPattern.best.id
        && retrievalPattern.best.score >= patternThresholds.retrievalConceptMinimum
        && retrievalPattern.best.score < patternThresholds.routingDomainSignalMinimum
      )
    );
  const retrievalDefinition = useRetrievalPattern
    ? selectedRetrievalPattern.definition
    : undefined;
  const selectedRetrievalScore = selectedRetrievalPattern?.score ?? 0;
  const compoundQuestion = retrievalDefinition?.compoundAnswer === true;
  const policyBoundaries = retrievalDefinitions
    // Route the mixed policy/live-state concept only through its explicit coordinated-clause boundary below.
    .filter((definition) =>
      definition.id !== "mixed_policy_and_live_state"
      && (
        definition.deferReason !== undefined
        || definition.sensitiveTopic === true
      ))
    .map((definition) => ({
      definition,
      score: retrievalPattern.scores[definition.id] ?? 0,
    }))
    // A protected concept must also support the response shape requested by the question.
    .filter((candidate) => answerPatternCompatible(candidate.definition))
    .filter((candidate) =>
      candidate.score >= (candidate.definition.minimumScore ?? 0.8)
      && candidate.score >= retrievalPattern.best.score - patternThresholds.safetyBoundaryProximity)
    .sort((left, right) => right.score - left.score);
  // A protected-source boundary must win the classifier, not merely neighbor a public compensation concept.
  const hardPolicyBoundary = policyBoundaries.find((candidate) =>
    candidate.definition.deferReason === "policy_sensitive_source"
    && candidate.definition.id === retrievalPattern.best.id);
  // Preserve a high-confidence mixed live-state boundary even when a supported policy clause scores slightly higher.
  // A mixed policy/live-state boundary needs explicit sentence or conjunction structure, not only embedding proximity.
  const hasCoordinatedClause = sentenceSegments.length > 1
    || /\b(?:e|and|y)\b/iu.test(semanticInputQuestion);
  const mixedLiveStateBoundary = mixedScopeCompositionSignal
    && hasCoordinatedClause
    && !retrievalContext.usedHistory
    ? retrievalDefinitions
      .filter((definition) => definition.id === "mixed_policy_and_live_state")
      .map((definition) => ({
        definition,
        score: retrievalPattern.scores[definition.id] ?? 0,
      }))
      .find((candidate) =>
        candidate.score >= (candidate.definition.minimumScore ?? 0.8))
    : undefined;
  const sensitiveBoundary = policyBoundaries.find((candidate) =>
    candidate.definition.deferReason !== "policy_sensitive_source")
    ?? mixedLiveStateBoundary;
  const knownGapBoundary = retrievalDefinitions
    .filter((definition) => definition.knownCorpusGap === true)
    .map((definition) => ({
      definition,
      score: retrievalPattern.scores[definition.id] ?? 0,
    }))
    // A known corpus gap may defer only when it is the classifier's best concept, not a near neighbor.
    .filter((candidate) =>
      candidate.definition.id === retrievalPattern.best.id
      &&
      candidate.score >= (
        candidate.definition.minimumScore
        ?? patternThresholds.retrievalExpansionMinimum
      ))
    .sort((left, right) => right.score - left.score)[0];
  const semanticExpansionCandidate = retrievalDefinition !== undefined
    && selectedRetrievalScore >= patternThresholds.retrievalExpansionMinimum
    && selectedRetrievalPattern !== undefined
    && (
      selectedRetrievalPattern.selectionScore - nextCompatibleScore
        >= (retrievalDefinition.minimumMargin ?? patternThresholds.retrievalExpansionMargin)
      || compatibleRetrievalPatterns.length === 1
    );
  const candidatePreferredSourceTypes = retrievalDefinition?.preferredSourceTypes ?? [];

  // Reserve human handoff for an explicit whole-question or sentence-level terminal request.
  if (routingAnalyses.some((analysis) =>
    analysis.best.id === "human_requested"
    && routingIntentIsSupported(analysis, "human_requested")
    && analysis.best.score >= patternThresholds.routingDomainSignalMinimum)) {
    const reason: HandoffReason = "human_requested";
    // Persist the competing intent scores even though explicit human routing exits before corpus retrieval.
    const trace = emptyGovernanceTrace(
      input,
      traceId,
      "defer",
      reason,
      started,
      "The requester explicitly asked for a person.",
    );
    trace.retrievalDiagnostics = {
      queryTokens: tokenize(input.question),
      expandedTerms: [],
      concepts: [routing.best.id, retrievalPattern.best.id, queryPattern!.best.id],
      answerRequirement: queryPattern!.best.id,
      classifierScores,
    };
    saveTrace(trace);
    return deferredDecision(input, traceId, reason, 0);
  }

  if (routingIntentIsSupported(routing, "governance_attack")) {
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

  const documents = loadSourceDocuments();
  const retrievalStarted = performance.now();
  const semanticQueries = [
    retrievalContext.question,
    ...(semanticExpansionCandidate && retrievalDefinition?.retrievalHint
      ? [retrievalDefinition.retrievalHint]
      : []),
  ];
  const semanticBatch = await runtimeSemanticSearchMany(documents, semanticQueries, 192);
  const directSemanticCandidates = semanticBatch.candidates[0] ?? [];
  const directSemanticScores = new Map(
    directSemanticCandidates.map((candidate) => [candidate.passage.id, candidate.score]),
  );
  // Let strong direct FAQ evidence defeat a cross-domain concept without weakening policy or agreement expansion.
  const directTopCandidate = directSemanticCandidates[0];
  const conceptTopCandidate = semanticBatch.candidates[1]?.[0];
  const conceptDomainCoherent = directTopCandidate === undefined
    || conceptTopCandidate === undefined
    || directTopCandidate.document.domain === conceptTopCandidate.document.domain
    || directTopCandidate.document.sourceType !== "faq"
    || directTopCandidate.score < patternThresholds.standalonePromptSemanticMinimum;
  const semanticExpansionEnabled = semanticExpansionCandidate
    && conceptDomainCoherent
    && (
      selectedRetrievalScore >= patternThresholds.routingDomainSignalMinimum
      || (
        candidatePreferredSourceTypes.length > 0
        && candidatePreferredSourceTypes.includes(
          directSemanticCandidates[0]?.document.sourceType ?? "",
        )
      )
    );
  const expectedPattern: AnswerPattern | undefined = semanticExpansionEnabled
    ? retrievalDefinition?.answerPattern
    : undefined;
  const preferredSourceTypes: string[] = semanticExpansionEnabled
    ? candidatePreferredSourceTypes
    : [];
  const requiredSourceTypes: string[] = semanticExpansionEnabled
    ? retrievalDefinition?.requiredSourceTypes ?? []
    : [];
  const mergedSemanticCandidates = new Map(
    directSemanticCandidates.map((candidate) => [candidate.passage.id, candidate]),
  );
  for (const candidates of semanticExpansionEnabled
    ? semanticBatch.candidates.slice(1)
    : []) {
    for (const candidate of candidates) {
      const current = mergedSemanticCandidates.get(candidate.passage.id);
      if (current === undefined || candidate.score > current.score) {
        mergedSemanticCandidates.set(candidate.passage.id, candidate);
      }
    }
  }
  const semantic = {
    candidates: [...mergedSemanticCandidates.values()]
      .sort((left, right) => right.score - left.score || left.passage.id.localeCompare(right.passage.id)),
    mode: semanticBatch.mode,
  };
  // Preserve retrieval-hint alignment independently from the direct-question score used by hybrid fusion.
  const conceptSemanticScores = new Map<string, number>();
  for (const candidates of semanticExpansionEnabled ? semanticBatch.candidates.slice(1) : []) {
    for (const candidate of candidates) {
      conceptSemanticScores.set(
        candidate.passage.id,
        Math.max(conceptSemanticScores.get(candidate.passage.id) ?? 0, candidate.score),
      );
    }
  }
  const semanticProviderStatus = semantic.mode === "learned" ? "ok" : "degraded";
  const requestedRegion = routingIntentIsSupported(routing, "requester_context_override")
    ? undefined
    : explicitRegion(semanticInputQuestion, documents);
  const resolvedRegion = input.requester.baseId;
  const superseded = activeSupersededSources(documents, input);
  const strongDirectEvidence = semantic.mode === "learned"
    && directSemanticCandidates.some((candidate) =>
      candidate.score >= patternThresholds.genericDirectSemanticMinimum
      && sourceMatchesRequestedRegion(candidate, requestedRegion)
      && evaluateEligibility(candidate.document, input, superseded).eligible);

  const strongOutOfScope = routingIntentIsTerminal(routing, "out_of_scope")
    && (routing.scores.out_of_scope ?? 0)
      >= initialRetrievalPattern!.best.score;
  if (!compoundQuestion && strongOutOfScope && !strongDirectEvidence) {
    const decision: Decision = {
      kind: "conversational",
      body: "Este atendimento é limitado a políticas e processos de People Operations. Posso ajudar com uma dúvida desse contexto.",
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started,
      "The question has a strong semantic out-of-scope signal and no comparable People Operations concept."));
    return decision;
  }

  if (routingIntentIsTerminal(routing, "out_of_scope")
    && routing.best.score - routing.second.score
      >= patternThresholds.mixedScopeRoutingMargin
    && initialDomainSignal
    && mixedScopeCompositionSignal
    && await hasMixedScopeClauseBoundary(semanticInputQuestion)) {
    const reason: HandoffReason = "missing_source";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started,
      "The request combines a supported People Operations concept with a separately unsupported information need."));
    return deferredDecision(input, traceId, reason, 0.08);
  }

  if (hardPolicyBoundary?.definition.deferReason) {
    const reason = hardPolicyBoundary.definition.deferReason;
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started,
      `Versioned semantic policy boundary: ${hardPolicyBoundary.definition.id}.`));
    return deferredDecision(input, traceId, reason, 0);
  }

  if (!compoundQuestion
    && (
      routingIntentIsTerminal(routing, "service_capability")
      || (
        ["gratitude", "greeting"].includes(routing.best.id)
        && routing.best.score >= 0.84
        && routing.best.score - routing.second.score >= 0.02
      )
      || (
        !initialDomainSignal
        && !retrievalDefinition
        && (routingIntentIsTerminal(routing, "gratitude") || routingIntentIsTerminal(routing, "greeting"))
      )
    )) {
    const decision: Decision = {
      kind: "conversational",
      body: routing.best.id === "gratitude"
        ? "De nada. Estou à disposição para outras dúvidas sobre People Operations."
        : routing.best.id === "service_capability"
          ? "Posso orientar sobre políticas e processos de People Operations, como folha, jornada, benefícios, férias, admissão e segurança, sempre usando fontes governadas. Questões individuais ou sem evidência são encaminhadas para a equipe responsável."
          : "Olá! Posso orientar sobre políticas e processos de People Operations ou encaminhar o atendimento para uma pessoa.",
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started,
      `Semantic route: ${routing.best.id}. No policy decision was requested.`));
    return decision;
  }

  if (
    !compoundQuestion
    &&
    !initialDomainSignal
    && !retrievalDefinition
    && !hardPolicyBoundary
    && !sensitiveBoundary
    && !strongDirectEvidence
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

  if (compoundQuestion && !initialDomainSignal && !retrievalDefinition
    && !hardPolicyBoundary && !sensitiveBoundary
    && !strongDirectEvidence
    && routingIntentIsTerminal(routing!, "out_of_scope")) {
    const reason: HandoffReason = "missing_source";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started,
      "At least one independent part of the compound question is outside the governed People Operations corpus."));
    return deferredDecision(input, traceId, reason, 0.08);
  }

  const liveStateDefinition = semanticPatternConfig().routingPatterns.find((pattern) =>
    pattern.id === "live_individual_state");
  const liveStateSupported = routing!.best.id === "live_individual_state"
    && (routing!.scores.live_individual_state ?? 0)
      >= (liveStateDefinition?.terminalMinimum ?? patternThresholds.terminalIntentMinimum);
  const individualStateSupported = queryPattern!.best.id === "individual_state";
  const contextFreeConcept = retrievalDefinition !== undefined
    && selectedRetrievalScore >= (
      retrievalDefinition.contextFreeMinimum
      ?? retrievalDefinition.minimumScore
      ?? patternThresholds.retrievalConceptMinimum
    );
  const retrieval = lexicalIndex(documents).search(retrievalContext.question, 192);
  // Attach the concept score after fusion so a platform-sensitive direct score cannot erase it.
  const hybridCandidates = fuseRetrieval(retrieval.candidates, semantic.candidates, 256)
    .map((candidate) => ({
      ...candidate,
      conceptSemanticScore: conceptSemanticScores.get(candidate.passage.id),
    }));
  const retrievalMs = performance.now() - retrievalStarted;
  const topScore = hybridCandidates.reduce((strongest, candidate) =>
    Math.max(strongest, retrievalStrength(candidate)), 0);
  const relevanceFloor = Math.max(0.55, topScore * 0.12);
  // Govern passages first: a later clause in the same source can be the only sufficient answer.
  const candidates = hybridCandidates
    .filter((candidate) => sourceMatchesRequestedRegion(candidate, requestedRegion))
    .filter((candidate) =>
      requiredSourceTypes.length === 0
      || requiredSourceTypes.includes(candidate.document.sourceType))
    .filter((candidate) => retrievalStrength(candidate) >= relevanceFloor)
    .slice(0, MAX_GOVERNED_CANDIDATES);

  const governanceStarted = performance.now();
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
  const [answerAlignments, promptAlignments, passageAnalyses] = await Promise.all([
    runtimeAnswerAlignment(documents, retrievalContext.question, eligible),
    runtimePromptAlignment(documents, retrievalContext.question, eligible),
    runtimeCandidateAnswerPatterns(documents, eligible),
  ]);
  const passagePatterns = new Map(eligible.map((candidate, index) =>
    [candidate.passage.id, passageAnalyses[index]!] as const));
  const alignedEligible = eligible.map((candidate, index) => ({
    ...candidate,
    answerSemanticScore: answerAlignments[index],
    promptSemanticScore: promptAlignments[index],
  }));
  const topAnswerSemanticScore = alignedEligible.reduce((top, candidate) =>
    Math.max(top, candidate.answerSemanticScore ?? 0), 0);
  const topPromptSemanticScore = alignedEligible.reduce((top, candidate) =>
    Math.max(top, candidate.promptSemanticScore ?? 0), 0);
  const promptSemanticScores = alignedEligible
    .flatMap((candidate) => candidate.promptSemanticScore === undefined
      ? []
      : [candidate.promptSemanticScore])
    .sort((left, right) => right - left);
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
    topPromptSemanticScore,
    secondPromptSemanticScore: promptSemanticScores[1] ?? 0,
    answerSemanticMinimum: retrievalDefinition?.answerAlignmentMinimum
      ?? patternThresholds.answerSemanticMinimum,
    semanticWindowMultiplier: retrievalDefinition?.semanticWindowMultiplier ?? 1,
    expectedPattern,
    answerPatternFlexible: retrievalDefinition?.answerPatternFlexible === true,
    preferredSourceTypes,
    compoundAnswerSameDomain: retrievalDefinition?.compoundAnswerSameDomain ?? false,
    learned: semantic.mode === "learned",
  };
  const requirement = expectedPattern ?? answerRequirement(queryPattern!);
  const answerEligible = requiredSourceTypes.length > 0
    ? alignedEligible.filter((candidate) => requiredSourceTypes.includes(candidate.document.sourceType))
    : alignedEligible;
  const rankedEligible = rankEligible(answerEligible, input, requirement, supportContext);
  // Recognize a complete standalone question when an eligible passage has unusually strong exact retrieval support.
  const strongStandaloneLexicalEvidence = rankedEligible.some((candidate) =>
    (candidate.sufficiencyScore ?? 0) > 0
    && (candidate.lexicalScore ?? 0)
      >= patternThresholds.genericDirectLexicalMinimum * 2);
  // Persist real candidates and classifier scores when a post-retrieval safety boundary exits early.
  const savePostRetrievalBoundary = (decision: Decision, note: string): void => {
    const governanceElapsed = performance.now() - governanceStarted;
    const confidence = evidenceConfidence(
      decision,
      [],
      [],
      requestedRegion === input.requester.baseId ? requestedRegion : undefined,
    );
    saveRoutingTrace(
      input,
      traceId,
      decision,
      candidates,
      rankedEligible,
      rejected,
      [],
      {
        queryTokens: retrieval.queryTokens,
        expandedTerms: [],
        concepts: [
          routing.best.id,
          queryPattern!.best.id,
          ...(retrievalDefinition ? [retrievalDefinition.id] : []),
        ],
        explicitRegion: requestedRegion,
        resolvedRegion,
        requirement,
        providerStatus: semanticProviderStatus,
        contextualized: retrievalContext.usedHistory,
        contextualTurns: retrievalContext.contextualTurns,
        classifierScores,
        note,
      },
      confidence,
      {
        retrieval: retrievalMs,
        governance: governanceElapsed,
        decision: 0,
        total: performance.now() - started,
      },
    );
  };
  // Absorb harmless native-versus-x64 rounding drift without crossing a full selection margin.
  const stablePromptEvidenceMinimum = patternThresholds.promptSemanticMinimum
    - patternThresholds.promptSelectionMargin;
  const standalonePromptEvidence = alignedEligible.some((candidate) =>
      (candidate.promptSemanticScore ?? 0) >= stablePromptEvidenceMinimum
      && (directSemanticScores.get(candidate.passage.id) ?? 0)
        >= patternThresholds.standalonePromptSemanticMinimum
      && (candidate.answerSemanticScore ?? 0) >= patternThresholds.genericDirectAnswerMinimum
      && (
        candidate.queryCoverage >= patternThresholds.genericDirectCoverageMinimum
        || (candidate.lexicalScore ?? 0)
          >= patternThresholds.genericDirectLexicalMinimum * 2
      ));
  const sensitiveCapabilityOverride = standalonePromptEvidence
    && sensitiveBoundary?.definition.id !== "mixed_policy_and_live_state"
    && composition!.best.score - composition!.second.score
      < patternThresholds.sensitiveCapabilityCompositionMarginMaximum;
  if (sensitiveBoundary?.definition.sensitiveTopic === true
    && !sensitiveCapabilityOverride
    && retrievalDefinition?.liveStateOverride !== true) {
    const reason: HandoffReason = "sensitive_topic";
    // Save the governed retrieval evidence that led to the sensitive boundary.
    const decision = deferredDecision(input, traceId, reason, 0.96);
    savePostRetrievalBoundary(
      decision,
      `Versioned semantic sensitive boundary: ${sensitiveBoundary.definition.id}.`,
    );
    return decision;
  }
  const knownGapPromptEvidence = alignedEligible.some((candidate) =>
    (candidate.promptSemanticScore ?? 0) >= stablePromptEvidenceMinimum
    && (directSemanticScores.get(candidate.passage.id) ?? 0)
      >= patternThresholds.genericDirectSemanticMinimum
    && (candidate.answerSemanticScore ?? 0) >= patternThresholds.genericDirectAnswerMinimum);
  // An unusually strong exact corpus match proves a single supported capability despite composition drift.
  const knownGapCapabilityOverride = knownGapPromptEvidence
    && (
      composition!.best.score - composition!.second.score
        < patternThresholds.sensitiveCapabilityCompositionMarginMaximum
      || strongStandaloneLexicalEvidence
    );
  if (knownGapBoundary !== undefined && !knownGapCapabilityOverride) {
    const reason: HandoffReason = "missing_source";
    // Save the retrieved passages that failed to resolve the classified corpus gap.
    const decision = deferredDecision(input, traceId, reason, 0.08);
    savePostRetrievalBoundary(
      decision,
      "A versioned semantic concept identifies a known gap and no uniquely aligned governed prompt resolves it.",
    );
    return decision;
  }
  // Preserve static capability guidance only when direct, well-covered evidence resolves live-state ambiguity.
  const unresolvedSensitiveState = retrievalDefinitions
    .filter((definition) => definition.sensitiveTopic === true)
    .some((definition) =>
      (retrievalPattern.scores[definition.id] ?? 0)
        >= (
          definition.minimumScore
          ?? Math.max(
            patternThresholds.retrievalExpansionMinimum,
            patternThresholds.routingDomainSignalMinimum,
          )
        ));
  const staticCapabilityEvidence = standalonePromptEvidence
    && composition!.best.score - composition!.second.score
      < patternThresholds.sensitiveCapabilityCompositionMarginMaximum;
  if (liveStateSupported && individualStateSupported
    && (!standalonePromptEvidence || (unresolvedSensitiveState && !staticCapabilityEvidence))
    && (
      retrievalDefinition?.policyGuidanceOverride !== true
      || routingIntentIsTerminal(routing!, "live_individual_state")
    )
    && retrievalDefinition?.liveStateOverride !== true) {
    const reason: HandoffReason = "sensitive_topic";
    // Save the static candidates that were rejected as proof of live individual state.
    const decision = deferredDecision(input, traceId, reason, 0.96);
    savePostRetrievalBoundary(
      decision,
      "The request requires live individual transactional state, which static governed sources do not provide.",
    );
    return decision;
  }
  // Apply the conversational fallback only to a genuinely short follow-up without standalone evidence.
  if (routingIntentIsContextual(routing!, semanticInputQuestion) && !retrievalContext.usedHistory && !contextFreeConcept
    && !standalonePromptEvidence && !strongStandaloneLexicalEvidence) {
    const contextualDecision: Decision = {
      kind: "conversational",
      body: "Posso responder a pergunta complementar quando houver uma decisão anterior no mesmo contexto. Faça primeiro a pergunta principal de People Operations.",
      traceId,
    };
    // Save candidate evidence and classifier scores for unsupported contextual follow-ups.
    savePostRetrievalBoundary(
      contextualDecision,
      "A referential follow-up had no completed user question establishing a trusted topic.",
    );
    return contextualDecision;
  }
  const conflictDomain = rankedEligible.find((candidate) =>
    (candidate.sufficiencyScore ?? 0) > 0)?.document.domain;
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
  // Retain a nearby conflict-bearing concept even when a sibling concept wins by a platform-sensitive tie.
  const conflictRetrievalDefinition = retrievalDefinition?.conflictOnMultipleSources
    && semanticExpansionEnabled
    ? retrievalDefinition
    : requirement === "location_or_channel"
      ? compatibleRetrievalPatterns.slice(0, 2).find((candidate) =>
        candidate.definition.conflictOnMultipleSources === true
        && candidate.definition.answerPattern === "location_or_channel"
        && candidate.score >= retrievalPattern.best.score - patternThresholds.semanticWindow)
        ?.definition
      : undefined;
  // Require a strong conflict concept, or a channel question whose competing sources are exceptionally close.
  const strongConflictConcept =
    selectedRetrievalScore >= patternThresholds.routingDomainSignalMinimum;
  if (hasSufficientCandidate
    && conflictRetrievalDefinition !== undefined
    && (
      strongConflictConcept
      || conflictRetrievalDefinition.answerPattern === "location_or_channel"
    )) {
    // Give dual-authority concepts a stable consensus window across embedding runtimes.
    const consensusMultiplier = conflictRetrievalDefinition.conflictWindowMultiplier ?? 2;
    const consensusWindow = patternThresholds.semanticWindow
      * consensusMultiplier;
    const consensusSourceTypes = conflictRetrievalDefinition.requiredSourceTypes ?? [];
    // Keep semantic consensus anchored to the selected concept as well as the question's domain.
    const topConceptSemanticScore = conflictRetrievalDefinition === retrievalDefinition
      ? alignedEligible.reduce((top, candidate) =>
        Math.max(top, candidate.conceptSemanticScore ?? 0), 0)
      : 0;
    const consensusCandidates = alignedEligible.filter((candidate) =>
      candidate.semanticScore !== undefined
      && (conflictDomain === undefined || candidate.document.domain === conflictDomain)
      && (
        consensusSourceTypes.length === 0
        || consensusSourceTypes.includes(candidate.document.sourceType)
      )
      && (
        topConceptSemanticScore === 0
        || (candidate.conceptSemanticScore ?? 0) >= topConceptSemanticScore - consensusWindow
      )
      && candidate.semanticScore >= supportContext.topSemanticScore - consensusWindow
      && (candidate.answerSemanticScore ?? 0) >= supportContext.answerSemanticMinimum
      && retrievalStrength(candidate) >= RETRIEVAL_LIMITS.minimumRelevance);
    const bySource = new Map(consensusCandidates.map((candidate) =>
      [candidate.document.sourceId, candidate] as const));
    const distinct = [...bySource.values()];
    // A typed multi-authority conflict requires representation from every configured authority class.
    const observedSourceTypes = new Set(distinct.map((candidate) => candidate.document.sourceType));
    const hasRequiredSourceTypeConsensus = consensusSourceTypes.every((sourceType) =>
      observedSourceTypes.has(sourceType));
    if (distinct.length > 1 && hasRequiredSourceTypeConsensus && conflicts.length === 0) {
      conflicts.push({
        domain: distinct[0]!.document.domain,
        left: distinct[0]!,
        right: distinct[1]!,
        signals: ["semantic_consensus_required"],
      });
    }
  }
  if (semantic.mode === "degraded") {
    const topLexicalScore = alignedEligible.reduce((top, candidate) =>
      Math.max(top, candidate.lexicalScore ?? 0), 0);
    const degradedDomain = rankedEligible[0]?.document.domain;
    const degradedConflictCandidates = alignedEligible.filter((candidate) =>
      (degradedDomain === undefined || candidate.document.domain === degradedDomain)
      &&
      (candidate.lexicalScore ?? 0) >= topLexicalScore
        * patternThresholds.degradedAuthorityLexicalRatio
      && candidate.queryCoverage >= patternThresholds.degradedAuthorityCoverageMinimum);
    const knownPairs = new Set(conflicts.map((conflict) =>
      [conflict.left.document.sourceId, conflict.right.document.sourceId].sort().join("\n")));
    for (const conflict of detectConflicts(degradedConflictCandidates)) {
      const pair = [conflict.left.document.sourceId, conflict.right.document.sourceId].sort().join("\n");
      if (!knownPairs.has(pair)) {
        knownPairs.add(pair);
        conflicts.push(conflict);
      }
    }
    const degradedAuthorities = new Map(degradedConflictCandidates.map((candidate) =>
      [candidate.document.sourceId, candidate] as const));
    if (hasSufficientCandidate && conflicts.length === 0 && degradedAuthorities.size > 1) {
      const distinct = [...degradedAuthorities.values()];
      conflicts.push({
        domain: distinct[0]!.document.domain,
        left: distinct[0]!,
        right: distinct[1]!,
        signals: ["degraded_multi_authority_ambiguity"],
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
  const relationshipAuthorityGap = retrievalDefinition?.relationshipGapIsMissingSource === true
    && rejected.some((item) =>
      item.rejectionCodes.length === 1
      && item.rejectionCodes[0] === "scope"
      && sourceHasRelationshipOnlyGap(item.candidate, input));
  if (candidates.length === 0 || topScore < MIN_RELEVANCE) {
    decision = deferredDecision(input, traceId, "missing_source", 0.08);
  } else if (regionProfileMismatch) {
    decision = deferredDecision(input, traceId, "profile_mismatch", 0.12, rejected);
  } else if (applicableExpiredSource) {
    decision = deferredDecision(input, traceId, "missing_source", 0.12, rejected);
  } else if (eligible.length === 0) {
    decision = deferredDecision(
      input,
      traceId,
      relationshipAuthorityGap ? "missing_source" : deferReasonForRejected(rejected),
      0.12,
      rejected,
    );
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
  // Persist the full classifier comparison alongside final governed retrieval evidence.
  saveRoutingTrace(input, traceId, decision, candidates, rankedEligible, rejected, conflicts,
    { queryTokens: retrieval.queryTokens, expandedTerms: [], concepts: [
      routing!.best.id,
      queryPattern!.best.id,
      ...(retrievalDefinition ? [retrievalDefinition.id] : []),
      ...(compoundQuestion ? ["compound_question"] : []),
    ],
      explicitRegion: requestedRegion, resolvedRegion, requirement, providerStatus: semanticProviderStatus,
      contextualized: retrievalContext.usedHistory, contextualTurns: retrievalContext.contextualTurns,
      classifierScores }, confidence,
    { retrieval: retrievalMs, governance: governanceMs, decision: decisionMs, total: performance.now() - started });
  return decision;
}

export async function withProviderFailureBoundary(
  input: DecideRequest,
  operation: () => Promise<Decision>,
): Promise<Decision> {
  const started = performance.now();
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof SemanticProviderUnavailableError)) throw error;
    const traceId = traceIdFor(input);
    saveTrace(emptyGovernanceTrace(
      input,
      traceId,
      "defer",
      "provider_failure",
      started,
      "The semantic provider became unavailable during the request; no provider output was used as evidence.",
      "degraded",
    ));
    return deferredDecision(input, traceId, "provider_failure", 0);
  }
}

export async function decide(input: DecideRequest): Promise<Decision> {
  return withProviderFailureBoundary(input, () => decideGoverned(input));
}
