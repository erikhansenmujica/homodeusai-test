import { RETRIEVAL_LIMITS } from "./domain-config.ts";
import {
  semanticPatternConfig,
  type AnswerPattern,
  type SemanticPatternAnalysis,
} from "./semantic-patterns.ts";
import type { DecideRequest, RetrievalCandidate } from "./types.ts";

export type AnswerRequirement = AnswerPattern;

export interface SemanticSupportContext {
  queryPattern: SemanticPatternAnalysis<AnswerPattern>;
  passagePatterns: Map<string, SemanticPatternAnalysis<AnswerPattern>>;
  topSemanticScore: number;
  secondSemanticScore: number;
  topSemanticSourceId?: string;
  topSemanticSourceShare: number;
  topAnswerSemanticScore: number;
  topPromptSemanticScore: number;
  secondPromptSemanticScore: number;
  answerSemanticMinimum: number;
  semanticWindowMultiplier: number;
  expectedPattern?: AnswerPattern;
  answerPatternFlexible: boolean;
  preferredSourceTypes: string[];
  compoundAnswerSameDomain: boolean;
  learned: boolean;
}

export function answerRequirement(
  analysis: SemanticPatternAnalysis<AnswerPattern>,
): AnswerRequirement {
  return analysis.best.id;
}

export function retrievalStrength(candidate: RetrievalCandidate): number {
  const lexicalRaw = candidate.lexicalScore ?? (candidate.matchedTerms.length > 0 ? candidate.score : 0);
  const lexical = Math.log1p(Math.max(0, lexicalRaw)) * 1.2;
  const reciprocalRankFusion = (candidate.fusionScore ?? 0) * 100;
  const semantic = (candidate.semanticScore ?? 0) * 4;
  const answerSemantic = (candidate.answerSemanticScore ?? 0) * 4;
  return Math.max(lexical, reciprocalRankFusion, semantic, answerSemantic);
}

function structuralShape(candidate: RetrievalCandidate, requirement: AnswerRequirement): boolean | undefined {
  const text = candidate.passage.answerText;
  if (requirement === "percentage") return /\p{N}+(?:[,.]\p{N}+)?\s*%/u.test(text);
  if (requirement === "currency") {
    return /(?:\p{Sc}\s*\p{N}|\p{N}(?:[,.]\p{N}+)?\s*\p{Sc})/u.test(text);
  }
  return undefined;
}

function semanticShapeBonus(
  candidate: RetrievalCandidate,
  requirement: AnswerRequirement,
  context: SemanticSupportContext,
): number {
  if (requirement === "general_rule") return 0.4;
  const structural = structuralShape(candidate, requirement);
  if (structural !== undefined) {
    const queryConfident = context.expectedPattern === requirement
      || (
        context.queryPattern.best.id === requirement
        && context.queryPattern.best.score - context.queryPattern.second.score
          >= semanticPatternConfig().thresholds.structuralPatternMargin
      );
    if (!queryConfident) return 0;
    return structural ? 2 : -6;
  }
  const analysis = context.passagePatterns.get(candidate.passage.id);
  if (!analysis) return context.expectedPattern === requirement ? -2 : 0;
  const requirementScore = analysis.scores[requirement] ?? 0;
  const difference = analysis.best.score - requirementScore;
  const margin = semanticPatternConfig().thresholds.answerPatternMargin;
  if (difference <= margin) return 1.1 * (1 - difference / Math.max(margin, Number.EPSILON));
  return context.expectedPattern === requirement ? -3 : 0;
}

function semanticTopicSupport(candidate: RetrievalCandidate, context: SemanticSupportContext): boolean {
  if (!context.learned || candidate.semanticScore === undefined) return false;
  const thresholds = semanticPatternConfig().thresholds;
  const conceptuallySupported = context.expectedPattern !== undefined
    && (candidate.answerSemanticScore ?? 0)
      >= Math.min(context.answerSemanticMinimum, thresholds.genericDirectAnswerMinimum);
  const directlySupported = candidate.semanticScore >= thresholds.genericDirectSemanticMinimum
    && (candidate.answerSemanticScore ?? 0) >= thresholds.genericDirectAnswerMinimum
    && (
      candidate.queryCoverage >= thresholds.genericDirectCoverageMinimum
      || (candidate.lexicalScore ?? 0) >= thresholds.genericDirectLexicalMinimum
    );
  // Accept a passage that is jointly closest to the question and answer even when paraphrasing is lexical-light.
  const jointlyAlignedDirectSupport =
    candidate.semanticScore >= thresholds.genericDirectSemanticMinimum
    && candidate.semanticScore >= context.topSemanticScore - thresholds.semanticCandidateMargin
    && (candidate.answerSemanticScore ?? 0) >= thresholds.genericDirectAnswerMinimum
    && (candidate.answerSemanticScore ?? 0)
      >= context.topAnswerSemanticScore - thresholds.answerSemanticWindow;
  // Let rare exact wording establish support when answer alignment is strong but the embedding score is diffuse.
  const lexicallySpecificSupport =
    (candidate.lexicalScore ?? 0) >= thresholds.genericDirectLexicalMinimum
    && (candidate.answerSemanticScore ?? 0) >= thresholds.genericDirectAnswerMinimum;
  const corroboratedDirectSupport = candidate.semanticScore
      >= thresholds.genericCorroboratedSemanticMinimum
    && (candidate.answerSemanticScore ?? 0) >= thresholds.genericDirectAnswerMinimum
    && candidate.queryCoverage >= thresholds.genericCorroboratedCoverageMinimum
    && context.topSemanticScore >= thresholds.genericDirectSemanticMinimum;
  const promptSupported = (candidate.promptSemanticScore ?? 0) >= thresholds.promptSemanticMinimum
    && (candidate.promptSemanticScore ?? 0) >= context.topPromptSemanticScore - Number.EPSILON
    && context.topPromptSemanticScore - context.secondPromptSemanticScore
      >= thresholds.promptSemanticMargin
    && (candidate.answerSemanticScore ?? 0) >= thresholds.genericDirectAnswerMinimum;
  const semanticWindow = thresholds.semanticWindow
    * context.semanticWindowMultiplier
    * (
      context.expectedPattern !== undefined
      && context.preferredSourceTypes.includes(candidate.document.sourceType)
        ? 2
        : 1
    );
  return promptSupported || (
    (directlySupported
      || jointlyAlignedDirectSupport
      || lexicallySpecificSupport
      || corroboratedDirectSupport
      || conceptuallySupported)
    && candidate.semanticScore >= thresholds.semanticCandidateMinimum
    && candidate.semanticScore >= context.topSemanticScore - semanticWindow
  );
}

function sufficiency(
  candidate: RetrievalCandidate,
  requirement: AnswerRequirement,
  context: SemanticSupportContext,
): number {
  const thresholds = semanticPatternConfig().thresholds;
  const answerAligned = (candidate.answerSemanticScore ?? 0) >= context.answerSemanticMinimum;
  const lexicalSupport = candidate.queryCoverage >= thresholds.lexicalCoverageMinimum
    && (!context.learned || answerAligned);
  const topicSupport = lexicalSupport || semanticTopicSupport(candidate, context);
  return topicSupport ? 7 : -18;
}

function scopeSpecificity(candidate: RetrievalCandidate, input: DecideRequest): number {
  const scope = candidate.document.eligibility;
  const matches = [
    scope.legalEntityIds.includes(input.requester.legalEntityId),
    scope.baseIds.includes(input.requester.baseId),
    scope.relationships.includes(input.requester.relationship),
    scope.roles.includes(input.requester.role),
  ];
  const restricted = [scope.legalEntityIds, scope.baseIds, scope.relationships, scope.roles]
    .filter((values) => !values.includes("*")).length;
  return matches.filter(Boolean).length * 0.12 + restricted * 0.18;
}

export function rankEligible(
  candidates: RetrievalCandidate[],
  input: DecideRequest,
  requirement: AnswerRequirement,
  context: SemanticSupportContext,
): RetrievalCandidate[] {
  return candidates.map((candidate) => {
    const authorityScore = candidate.document.authorityTier / 100 * 1.2;
    const scopeScore = scopeSpecificity(candidate, input);
    const sufficiencyScore = sufficiency(candidate, requirement, context);
    const shapeScore = semanticShapeBonus(candidate, requirement, context);
    const semanticRankingWindow = semanticPatternConfig().thresholds.semanticWindow
      * context.semanticWindowMultiplier
      * (
        context.expectedPattern !== undefined
        && context.preferredSourceTypes.includes(candidate.document.sourceType)
          ? 2
          : 1
      );
    const semanticRankingScore = candidate.semanticScore === undefined ? 0
      : Math.max(0, 1 - (context.topSemanticScore - candidate.semanticScore)
        / Math.max(semanticRankingWindow, Number.EPSILON))
        * semanticPatternConfig().thresholds.semanticRankingWeight;
    const answerSemanticRankingScore = candidate.answerSemanticScore === undefined ? 0
      : Math.max(0, 1 - (context.topAnswerSemanticScore - candidate.answerSemanticScore)
        / Math.max(semanticPatternConfig().thresholds.answerSemanticWindow, Number.EPSILON))
        * semanticPatternConfig().thresholds.answerSemanticRankingWeight;
    const promptSemanticRankingScore = candidate.promptSemanticScore === undefined
      || candidate.promptSemanticScore < semanticPatternConfig().thresholds.promptSemanticMinimum
      || candidate.promptSemanticScore < context.topPromptSemanticScore - Number.EPSILON
      || context.topPromptSemanticScore - context.secondPromptSemanticScore
        < semanticPatternConfig().thresholds.promptSemanticMargin
      ? 0
      : Math.max(0, 1 - (context.topPromptSemanticScore - candidate.promptSemanticScore)
        / Math.max(semanticPatternConfig().thresholds.promptSemanticWindow, Number.EPSILON))
        * semanticPatternConfig().thresholds.promptSemanticRankingWeight;
    const sourceTypeRankingScore = context.preferredSourceTypes.includes(candidate.document.sourceType)
      ? semanticPatternConfig().thresholds.sourceTypeRankingWeight
      : 0;
    // Reward rare exact wording enough to beat a generic semantic template with no lexical retrieval support.
    const lexicalSpecificityRankingScore =
      (candidate.lexicalScore ?? 0)
        >= semanticPatternConfig().thresholds.genericDirectLexicalMinimum * 0.95
      && (candidate.answerSemanticScore ?? 0)
        >= semanticPatternConfig().thresholds.genericDirectAnswerMinimum
        ? 1.1
        : 0;
    return {
      ...candidate,
      authorityScore,
      scopeScore,
      sufficiencyScore,
      finalScore: retrievalStrength(candidate) + authorityScore + scopeScore + sufficiencyScore
        + shapeScore + semanticRankingScore + answerSemanticRankingScore
        + promptSemanticRankingScore
        + sourceTypeRankingScore + lexicalSpecificityRankingScore,
    };
  }).sort((left, right) =>
    (right.finalScore ?? 0) - (left.finalScore ?? 0)
    || retrievalStrength(right) - retrievalStrength(left));
}

export function selectAnswerCandidates(
  eligible: RetrievalCandidate[],
  requirement: AnswerRequirement,
  context: SemanticSupportContext,
): RetrievalCandidate[] {
  const primary = eligible.find((candidate) =>
    (candidate.sufficiencyScore ?? 0) > 0
    && retrievalStrength(candidate) >= RETRIEVAL_LIMITS.minimumRelevance);
  if (!primary) return [];
  const thresholds = semanticPatternConfig().thresholds;
  const preferredCandidates = context.expectedPattern === undefined
    ? []
    : eligible.filter((candidate) =>
      (candidate.sufficiencyScore ?? 0) > 0
      && context.preferredSourceTypes.includes(candidate.document.sourceType));
  // Use a confident channel answer shape when no retrieval concept supplied a stricter one.
  const shapeTarget = context.expectedPattern ?? (
    requirement === "location_or_channel"
      && context.queryPattern.best.score - context.queryPattern.second.score
      >= thresholds.structuralPatternMargin
      ? requirement
      : undefined
  );
  const shapeCandidates = context.expectedPattern === undefined
    ? eligible.filter((candidate) => (candidate.sufficiencyScore ?? 0) > 0)
    : preferredCandidates;
  const shapePreferred = context.answerPatternFlexible || shapeTarget === undefined
    ? undefined
    : shapeCandidates
    .filter((candidate) =>
      context.passagePatterns.get(candidate.passage.id)?.best.id === shapeTarget
      && (
        candidate.semanticScore === undefined
        || primary.semanticScore === undefined
        || candidate.semanticScore >= primary.semanticScore - thresholds.semanticWindow
      ))
    .sort((left, right) =>
      (right.semanticScore ?? 0) - (left.semanticScore ?? 0)
      || (right.finalScore ?? 0) - (left.finalScore ?? 0))[0];
  const promptPreferredCandidates = preferredCandidates
    .filter((candidate) => candidate.promptSemanticScore !== undefined)
    .sort((left, right) =>
      (right.promptSemanticScore ?? 0) - (left.promptSemanticScore ?? 0));
  const promptPreferred = (promptPreferredCandidates[0]?.promptSemanticScore ?? 0)
      >= thresholds.promptSemanticMinimum
    && (promptPreferredCandidates[0]?.promptSemanticScore ?? 0)
      - (promptPreferredCandidates[1]?.promptSemanticScore ?? 0)
      >= thresholds.promptSelectionMargin
    ? promptPreferredCandidates[0]
    : undefined;
  // Prefer the passage uniquely aligned with the selected retrieval concept before direct-score tie-breaks.
  const conceptPreferredCandidates = preferredCandidates
    .filter((candidate) => candidate.conceptSemanticScore !== undefined)
    .sort((left, right) =>
      (right.conceptSemanticScore ?? 0) - (left.conceptSemanticScore ?? 0));
  const conceptPreferred = (conceptPreferredCandidates[0]?.conceptSemanticScore ?? 0)
      - (conceptPreferredCandidates[1]?.conceptSemanticScore ?? 0)
      >= thresholds.promptSelectionMargin
    ? conceptPreferredCandidates[0]
    : undefined;
  const sourceCoherent = context.expectedPattern !== undefined
    && context.topSemanticSourceId !== undefined
    && context.topSemanticSourceShare >= thresholds.semanticClusterMinimum
    ? eligible
      .filter((candidate) =>
        (candidate.sufficiencyScore ?? 0) > 0
        && candidate.document.sourceId === context.topSemanticSourceId
        && (
          context.preferredSourceTypes.length === 0
          || context.preferredSourceTypes.includes(candidate.document.sourceType)
        )
        && (candidate.semanticScore ?? 0) >= context.topSemanticScore - thresholds.semanticWindow)
      // Preserve raw-question relevance within a coherent source instead of amplifying synthetic distractor features.
      .sort((left, right) =>
        (right.semanticScore ?? 0) - (left.semanticScore ?? 0)
        || (right.answerSemanticScore ?? 0) - (left.answerSemanticScore ?? 0)
        || (right.finalScore ?? 0) - (left.finalScore ?? 0))[0]
    : undefined;
  // Let materially stronger direct-question evidence defeat a concept-hint preference.
  const conceptOrSourcePreferred = conceptPreferred !== undefined
    && sourceCoherent !== undefined
    && (sourceCoherent.semanticScore ?? 0) - (conceptPreferred.semanticScore ?? 0)
      >= thresholds.semanticCandidateMargin
    ? sourceCoherent
    : conceptPreferred ?? sourceCoherent;
  const preferred = preferredCandidates
      .sort((left, right) =>
        (right.semanticScore ?? 0) - (left.semanticScore ?? 0)
        || (right.finalScore ?? 0) - (left.finalScore ?? 0))[0];
  // Let a materially stronger raw-question match defeat an answer-shape false positive within the same source.
  const shapeOrSourcePreferred = shapePreferred !== undefined
    && sourceCoherent !== undefined
    && (sourceCoherent.semanticScore ?? 0) - (shapePreferred.semanticScore ?? 0)
      < thresholds.promptSelectionMargin
    ? shapePreferred
    : sourceCoherent ?? shapePreferred;
  const selected = promptPreferred ?? conceptOrSourcePreferred ?? shapeOrSourcePreferred ?? (preferred !== undefined
    && (
      !context.preferredSourceTypes.includes(primary.document.sourceType)
      || (preferred.semanticScore ?? 0) - (primary.semanticScore ?? 0)
        >= thresholds.semanticCandidateMargin
    )
    ? preferred
    : primary);
  const authoritative = eligible
    .filter((candidate) =>
      (candidate.sufficiencyScore ?? 0) > 0
      && !context.preferredSourceTypes.includes(selected.document.sourceType)
      && (candidate.document.authorityTier - selected.document.authorityTier) / 100
        >= thresholds.authorityDominanceMinimum
      && (candidate.semanticScore ?? 0)
        >= (selected.semanticScore ?? 0) - thresholds.semanticWindow
      && (candidate.answerSemanticScore ?? 0)
        >= (selected.answerSemanticScore ?? 0) - thresholds.answerSemanticWindow
      && retrievalStrength(candidate) >= retrievalStrength(selected))
    .sort((left, right) =>
      right.document.authorityTier - left.document.authorityTier
      || (right.finalScore ?? 0) - (left.finalScore ?? 0))[0];
  const chosen = authoritative ?? selected;
  if (context.expectedPattern !== "list" || chosen.semanticScore === undefined) return [chosen];
  const secondary = eligible.find((candidate) =>
    candidate.passage.id !== chosen.passage.id
    && candidate.document.sourceId === chosen.document.sourceId
    && candidate.semanticScore !== undefined
    && candidate.semanticScore >= chosen.semanticScore! - thresholds.multiPassageWindow
    && (candidate.sufficiencyScore ?? 0) > 0
    && retrievalStrength(candidate) >= RETRIEVAL_LIMITS.minimumRelevance);
  return secondary ? [chosen, secondary] : [chosen];
}

export function selectCompoundAnswerCandidates(
  eligible: RetrievalCandidate[],
  context: SemanticSupportContext,
): RetrievalCandidate[] {
  const thresholds = semanticPatternConfig().thresholds;
  const candidates = eligible
    .filter((candidate) =>
      candidate.semanticScore !== undefined
      && candidate.semanticScore >= context.topSemanticScore - thresholds.semanticWindow * 2
      && (candidate.answerSemanticScore ?? 0) >= context.answerSemanticMinimum)
    .sort((left, right) =>
      right.queryCoverage - left.queryCoverage
      || (right.lexicalScore ?? 0) - (left.lexicalScore ?? 0)
      || (right.answerSemanticScore ?? 0) - (left.answerSemanticScore ?? 0)
      || (right.finalScore ?? retrievalStrength(right)) - (left.finalScore ?? retrievalStrength(left)));
  const pairs = candidates.flatMap((left, leftIndex) =>
    candidates.slice(leftIndex + 1).flatMap((right) => {
      const leftPattern = context.passagePatterns.get(left.passage.id)?.best.id;
      const rightPattern = context.passagePatterns.get(right.passage.id)?.best.id;
      if (
        left.document.sourceId === right.document.sourceId
        || (
          context.compoundAnswerSameDomain
          && left.document.domain !== right.document.domain
        )
        || leftPattern === rightPattern
      ) return [];
      const relevance = (candidate: RetrievalCandidate): number =>
        (candidate.semanticScore ?? 0)
        + (candidate.promptSemanticScore ?? 0) * 0.3
        + (candidate.answerSemanticScore ?? 0) * 0.2;
      return [{ candidates: [left, right] as const, score: relevance(left) + relevance(right) }];
    }));
  const selected = [...pairs].sort((left, right) => right.score - left.score)[0]?.candidates;
  return selected ? [...selected] : [];
}
