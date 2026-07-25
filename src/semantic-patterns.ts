import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PATTERN_PATH = resolve(process.env.SEMANTIC_PATTERN_PATH?.trim()
  || join(ROOT, "config", "semantic-patterns.json"));
const HASH_DIMENSIONS = 512;

export type RoutingIntent =
  | "policy_guidance"
  | "live_individual_state"
  | "human_requested"
  | "gratitude"
  | "greeting"
  | "service_capability"
  | "out_of_scope"
  | "governance_attack"
  | "requester_context_override"
  | "contextual_followup";

export type AnswerPattern =
  | "percentage"
  | "currency"
  | "duration"
  | "entitlement"
  | "list"
  | "event"
  | "boolean"
  | "location_or_channel"
  | "individual_state"
  | "general_rule";

export type CompositionPattern = "single_question" | "compound_question";
export type RetrievalConcept =
  | "timekeeping_required_events"
  | "apprentice_schedule"
  | "overtime_compensation"
  | "overtime_authorization_timing"
  | "payroll_statement_availability"
  | "protected_document_channel"
  | "identity_provisioning_event"
  | "admission_document_set"
  | "admission_submission_channel"
  | "admission_relationship_instrument"
  | "intern_time_bank"
  | "employment_relationship_effect"
  | "termination_formal_start"
  | "termination_provisional_date"
  | "termination_human_review"
  | "vacation_request_timing"
  | "request_submission_approval"
  | "meal_support"
  | "schedule_change_notice"
  | "timekeeping_adjustment_deadline"
  | "static_policy_capability_limit"
  | "urgent_incident_reporting"
  | "diagnosis_channel_limit"
  | "individual_financial_outcome"
  | "vacation_entitlement_or_balance"
  | "individual_record_attribute"
  | "individual_request_status"
  | "provisional_state_not_payment"
  | "restricted_compensation_reference"
  | "restricted_access_assignment"
  | "direct_medical_diagnosis"
  | "trace_exfiltration"
  | "sensitive_data_mutation"
  | "mixed_policy_and_live_state"
  | "multi_source_health_guidance"
  | "unsupported_employer_expense";

type PatternId = RoutingIntent | AnswerPattern | CompositionPattern | RetrievalConcept;
type PatternFamily = "routing" | "answer" | "composition" | "retrieval";
type VectorRole = "query" | "passage";

interface PatternDefinition {
  id: PatternId;
  examples: string[];
  terminalMinimum?: number;
  terminalMargin?: number;
  retrievalHint?: string;
  answerPattern?: AnswerPattern;
  answerPatternFlexible?: boolean;
  answerPatternMargin?: number;
  answerPatternSelectionWeight?: number;
  policyGuidanceOverride?: boolean;
  liveStateOverride?: boolean;
  sensitiveTopic?: boolean;
  knownCorpusGap?: boolean;
  contextFreeMinimum?: number;
  conflictWindowMultiplier?: number;
  semanticWindowMultiplier?: number;
  conflictOnMultipleSources?: boolean;
  compoundAnswer?: boolean;
  compoundAnswerSameDomain?: boolean;
  relationshipGapIsMissingSource?: boolean;
  deferReason?: "sensitive_topic" | "policy_sensitive_source";
  minimumScore?: number;
  minimumMargin?: number;
  answerAlignmentMinimum?: number;
  preferredSourceTypes?: string[];
  requiredSourceTypes?: string[];
  profileAffinityRelationships?: string[];
}

interface SemanticPatternConfig {
  schemaVersion: string;
  description: string;
  prototypeAggregation: "top_two_mean";
  thresholds: {
    terminalIntentMinimum: number;
    terminalIntentMargin: number;
    contextReferenceMinimum: number;
    routingDomainSignalMinimum: number;
    semanticCandidateMinimum: number;
    semanticCandidateMargin: number;
    semanticAbsoluteMinimum: number;
    semanticClusterMinimum: number;
    semanticWindow: number;
    multiPassageWindow: number;
    lexicalCorroborationMinimum: number;
    answerSemanticMinimum: number;
    answerSemanticWindow: number;
    answerSemanticRankingWeight: number;
    promptSemanticMinimum: number;
    promptSemanticMargin: number;
    promptSelectionMargin: number;
    promptSemanticWindow: number;
    promptSemanticRankingWeight: number;
    authorityDominanceMinimum: number;
    structuralPatternMargin: number;
    semanticRankingWeight: number;
    sourceTypeRankingWeight: number;
    retrievalConceptMinimum: number;
    retrievalConceptMargin: number;
    retrievalExpansionMinimum: number;
    retrievalExpansionMargin: number;
    lexicalCoverageMinimum: number;
    answerPatternMargin: number;
    answerPatternSelectionWeight: number;
    profileConceptBoost: number;
    genericDirectSemanticMinimum: number;
    genericDirectAnswerMinimum: number;
    genericDirectCoverageMinimum: number;
    genericDirectLexicalMinimum: number;
    genericCorroboratedSemanticMinimum: number;
    genericCorroboratedCoverageMinimum: number;
    safetyBoundaryMargin: number;
    safetyBoundaryProximity: number;
    standalonePromptSemanticMinimum: number;
    sensitiveCapabilityCompositionMarginMaximum: number;
    mixedScopeRoutingMargin: number;
    degradedAuthorityLexicalRatio: number;
    degradedAuthorityCoverageMinimum: number;
    compositionMinimum: number;
    compositionMargin: number;
  };
  routingPatterns: PatternDefinition[];
  answerPatterns: PatternDefinition[];
  compositionPatterns: PatternDefinition[];
  retrievalPatterns: PatternDefinition[];
}

export interface SemanticPatternMatch<T extends PatternId = PatternId> {
  id: T;
  score: number;
}

export interface SemanticPatternAnalysis<T extends PatternId = PatternId> {
  best: SemanticPatternMatch<T>;
  second: SemanticPatternMatch<T>;
  scores: Record<string, number>;
}

export function mergeSemanticPatternAnalyses<T extends PatternId>(
  analyses: Array<SemanticPatternAnalysis<T>>,
): SemanticPatternAnalysis<T> {
  if (analyses.length === 0) throw new Error("at least one semantic pattern analysis is required");
  const scores: Record<string, number> = {};
  for (const analysis of analyses) {
    for (const [id, score] of Object.entries(analysis.scores)) {
      scores[id] = Math.max(scores[id] ?? Number.NEGATIVE_INFINITY, score);
    }
  }
  const matches = Object.entries(scores)
    .map(([id, score]) => ({ id: id as T, score }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return { best: matches[0]!, second: matches[1]!, scores };
}

export interface SemanticEmbeddingProvider {
  embedQueries(inputs: string[]): Promise<number[][]>;
  embedPassages(inputs: string[]): Promise<number[][]>;
}

function parseConfig(): SemanticPatternConfig {
  const value = JSON.parse(readFileSync(PATTERN_PATH, "utf8")) as SemanticPatternConfig;
  if (value.schemaVersion !== "semantic-patterns-v1") throw new Error("semantic pattern schema is unsupported");
  if (value.prototypeAggregation !== "top_two_mean") throw new Error("semantic pattern aggregation is unsupported");
  if (!value.description?.trim()) throw new Error("semantic pattern description is required");
  const families = [
    value.routingPatterns,
    value.answerPatterns,
    value.compositionPatterns,
    value.retrievalPatterns,
  ];
  if (families.some((patterns) =>
    !Array.isArray(patterns)
    || patterns.length < 2
    || patterns.some((pattern) => !pattern.id || !Array.isArray(pattern.examples) || pattern.examples.length < 2))) {
    throw new Error("semantic pattern definitions are invalid");
  }
  if (families.flat().some((pattern) =>
    [pattern.terminalMinimum, pattern.terminalMargin].some((threshold) =>
      threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)))) {
    throw new Error("semantic pattern terminal thresholds are invalid");
  }
  if (value.retrievalPatterns.some((pattern) => !pattern.retrievalHint?.trim())) {
    throw new Error("semantic retrieval patterns require a retrieval hint");
  }
  const answerPatternIds = new Set(value.answerPatterns.map((pattern) => pattern.id));
  if (value.retrievalPatterns.some((pattern) =>
    pattern.answerPattern !== undefined && !answerPatternIds.has(pattern.answerPattern))) {
    throw new Error("semantic retrieval answer pattern is invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    pattern.answerPatternFlexible !== undefined
    && (
      typeof pattern.answerPatternFlexible !== "boolean"
      || pattern.answerPattern === undefined
    ))) {
    throw new Error("semantic retrieval answer pattern flexibility is invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    [
      pattern.policyGuidanceOverride,
      pattern.liveStateOverride,
      pattern.sensitiveTopic,
      pattern.knownCorpusGap,
      pattern.conflictOnMultipleSources,
      pattern.compoundAnswer,
      pattern.compoundAnswerSameDomain,
      pattern.relationshipGapIsMissingSource,
    ].some((flag) =>
      flag !== undefined && typeof flag !== "boolean"))) {
    throw new Error("semantic retrieval policy flags are invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    pattern.deferReason !== undefined
    && !["sensitive_topic", "policy_sensitive_source"].includes(pattern.deferReason))) {
    throw new Error("semantic retrieval defer reason is invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    [
      pattern.minimumScore,
      pattern.minimumMargin,
      pattern.answerPatternMargin,
      pattern.answerPatternSelectionWeight,
    ].some((threshold) =>
      threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)))) {
    throw new Error("semantic retrieval selection threshold is invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    pattern.contextFreeMinimum !== undefined
    && (
      !Number.isFinite(pattern.contextFreeMinimum)
      || pattern.contextFreeMinimum < 0
      || pattern.contextFreeMinimum > 1
    ))) {
    throw new Error("semantic retrieval context-free threshold is invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    [pattern.conflictWindowMultiplier, pattern.semanticWindowMultiplier].some((multiplier) =>
      multiplier !== undefined
      && (
        !Number.isFinite(multiplier)
        || multiplier < 1
        || multiplier > 3
      ))
  )) {
    throw new Error("semantic retrieval window multiplier is invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    pattern.answerAlignmentMinimum !== undefined
    && (
      !Number.isFinite(pattern.answerAlignmentMinimum)
      || pattern.answerAlignmentMinimum < value.thresholds.semanticCandidateMinimum
      || pattern.answerAlignmentMinimum > 1
    ))) {
    throw new Error("semantic retrieval answer alignment threshold is invalid");
  }
  if (value.retrievalPatterns.some((pattern) =>
    [
      pattern.preferredSourceTypes,
      pattern.requiredSourceTypes,
      pattern.profileAffinityRelationships,
    ].some((sourceTypes) =>
      sourceTypes !== undefined
      && (
        sourceTypes.length === 0
        || sourceTypes.some((sourceType) => !sourceType.trim())
      )))) {
    throw new Error("semantic retrieval source preferences are invalid");
  }
  if (Object.entries(value.thresholds).some(([name, threshold]) =>
    !Number.isFinite(threshold)
    || threshold < 0
    || (
      name.endsWith("Weight")
        ? threshold > 10
        : name === "genericDirectLexicalMinimum"
          ? threshold > 1_000
          : threshold > 1
    ))) {
    throw new Error("semantic pattern thresholds are invalid");
  }
  return value;
}

const config = parseConfig();

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

function similarity(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function deterministicVector(text: string): number[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("und");
  const vector = Array.from({ length: HASH_DIMENSIONS }, () => 0);
  const padded = `^^${normalized}$$`;
  for (let index = 0; index <= padded.length - 3; index += 1) {
    const digest = createHash("sha256").update(padded.slice(index, index + 3), "utf8").digest();
    vector[digest.readUInt32BE(0) % HASH_DIMENSIONS] += digest[4]! & 1 ? 1 : -1;
  }
  return normalize(vector);
}

export class DeterministicSemanticEmbeddingProvider implements SemanticEmbeddingProvider {
  async embedQueries(inputs: string[]): Promise<number[][]> {
    return inputs.map(deterministicVector);
  }

  async embedPassages(inputs: string[]): Promise<number[][]> {
    return inputs.map(deterministicVector);
  }
}

export class SemanticPatternIndex {
  private readonly provider: SemanticEmbeddingProvider;
  private readonly definitions: Record<PatternFamily, PatternDefinition[]>;
  private readonly vectors = new Map<PatternFamily, Map<PatternId, number[][]>>();
  private readyPromise: Promise<void> | undefined;

  constructor(provider: SemanticEmbeddingProvider) {
    this.provider = provider;
    this.definitions = {
      routing: config.routingPatterns,
      answer: config.answerPatterns,
      composition: config.compositionPatterns,
      retrieval: config.retrievalPatterns,
    };
  }

  async ready(): Promise<void> {
    this.readyPromise ??= this.build();
    return this.readyPromise;
  }

  private async build(): Promise<void> {
    for (const family of ["routing", "answer", "composition", "retrieval"] as const) {
      const definitions = this.definitions[family];
      const embedded = await this.provider.embedPassages(definitions.flatMap((pattern) => pattern.examples));
      const grouped = new Map<PatternId, number[][]>();
      let offset = 0;
      for (const definition of definitions) {
        grouped.set(definition.id, embedded.slice(offset, offset + definition.examples.length));
        offset += definition.examples.length;
      }
      this.vectors.set(family, grouped);
    }
  }

  async classify<T extends PatternId>(
    texts: string[],
    family: PatternFamily,
    role: VectorRole = "query",
  ): Promise<Array<SemanticPatternAnalysis<T>>> {
    await this.ready();
    const vectors = role === "query"
      ? await this.provider.embedQueries(texts)
      : await this.provider.embedPassages(texts);
    return this.classifyEmbedded<T>(vectors, family);
  }

  async classifyEmbedded<T extends PatternId>(
    vectors: number[][],
    family: PatternFamily,
  ): Promise<Array<SemanticPatternAnalysis<T>>> {
    await this.ready();
    const patterns = this.vectors.get(family)!;
    return vectors.map((vector) => {
      const matches = [...patterns.entries()].map(([id, examples]) => ({
        id: id as T,
        score: examples
          .map((example) => similarity(vector, example))
          .sort((left, right) => right - left)
          .slice(0, 2)
          .reduce((sum, value) => sum + value / Math.min(2, examples.length), 0),
      })).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
      return {
        best: matches[0]!,
        second: matches[1]!,
        scores: Object.fromEntries(matches.map((match) => [match.id, match.score])),
      };
    });
  }
}

export function semanticPatternConfig(): Readonly<SemanticPatternConfig> {
  return config;
}
