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
  answerSemanticMinimum: number;
  expectedPattern?: AnswerPattern;
  preferredSourceTypes: string[];
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
  const concentrated = context.topSemanticScore >= thresholds.semanticAbsoluteMinimum;
  const answerAligned = (candidate.answerSemanticScore ?? 0) >= context.answerSemanticMinimum;
  const conceptuallySupported = context.expectedPattern !== undefined && answerAligned;
  const semanticWindow = thresholds.semanticWindow * (
    context.expectedPattern !== undefined
    && context.preferredSourceTypes.includes(candidate.document.sourceType)
      ? 2
      : 1
  );
  return ((concentrated && answerAligned) || conceptuallySupported)
    && candidate.semanticScore >= thresholds.semanticCandidateMinimum
    && candidate.semanticScore >= context.topSemanticScore - semanticWindow;
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
    const semanticRankingWindow = semanticPatternConfig().thresholds.semanticWindow * (
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
    const sourceTypeRankingScore = context.preferredSourceTypes.includes(candidate.document.sourceType)
      ? semanticPatternConfig().thresholds.sourceTypeRankingWeight
      : 0;
    return {
      ...candidate,
      authorityScore,
      scopeScore,
      sufficiencyScore,
      finalScore: retrievalStrength(candidate) + authorityScore + scopeScore + sufficiencyScore
        + shapeScore + semanticRankingScore + answerSemanticRankingScore
        + sourceTypeRankingScore,
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
  const queryListScore = context.queryPattern.scores.list ?? 0;
  const listLike = context.expectedPattern === "list"
    || queryListScore >= context.queryPattern.best.score
      - semanticPatternConfig().thresholds.multiPassageWindow;
  if (!listLike || primary.semanticScore === undefined) return [primary];
  const primarySemanticScore = primary.semanticScore;
  const secondary = eligible.find((candidate) =>
    candidate.passage.id !== primary.passage.id
    && candidate.document.sourceId === primary.document.sourceId
    && candidate.semanticScore !== undefined
    && candidate.semanticScore >= primarySemanticScore - semanticPatternConfig().thresholds.multiPassageWindow
    && (candidate.sufficiencyScore ?? 0) > 0
    && retrievalStrength(candidate) >= RETRIEVAL_LIMITS.minimumRelevance);
  return secondary ? [primary, secondary] : [primary];
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
  const primary = candidates[0];
  if (!primary) return [];
  const primaryPattern = context.passagePatterns.get(primary.passage.id)?.best.id;
  const secondary = candidates.find((candidate) =>
    candidate.document.sourceId !== primary.document.sourceId
    && context.passagePatterns.get(candidate.passage.id)?.best.id !== primaryPattern);
  return secondary ? [primary, secondary] : [];
}
