import { readFileSync } from "node:fs";

export const MIN_CANDIDATE_CASES = 12;
export const MAX_CANDIDATE_CASES = 48;
export const MAX_TOTAL_EVAL_CASES = 50;

export const REQUIRED_RISK_TAGS = [
  "multi_source",
  "governance",
  "missing_evidence",
  "privacy_or_injection",
  "paraphrase_or_boundary",
  "counterfactual_boundary",
] as const;

export const DECISION_KINDS = ["answer", "defer", "conversational"] as const;

export const DEFER_REASONS = [
  "human_requested",
  "low_confidence",
  "conflicting_source",
  "missing_source",
  "profile_mismatch",
  "sensitive_topic",
  "validation_pending",
  "policy_sensitive_source",
  "provider_failure",
] as const;

type DecisionKind = (typeof DECISION_KINDS)[number];

export type TrustedProfile = {
  profileId: string;
  legalEntityId: string;
  baseId: string;
  relationship: string;
  role: string;
};

const PROFILE_AXES = ["legalEntityId", "baseId", "relationship", "role"] as const;
const trustedProfiles = new Map<string, TrustedProfile>(
  (JSON.parse(readFileSync(new URL("../case-data/actors/profiles.json", import.meta.url), "utf8")) as { profiles: TrustedProfile[] })
    .profiles.map((profile) => [profile.profileId, profile]),
);

export function resolveTrustedProfile(profileId: string): TrustedProfile | undefined {
  const profile = trustedProfiles.get(profileId);
  return profile ? { ...profile } : undefined;
}

export type RequiredClaim = {
  bodyTerm: string;
  sourceIds: string[];
  quoteTerms: string[];
};

export type CandidateEvalCase = {
  id: string;
  sample?: boolean;
  objective: string;
  clusterId: string;
  profileId: string;
  question: string;
  asOf: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  tags: string[];
  expected: {
    kind: DecisionKind;
    reasonCode?: string;
    requiredSourceIds?: string[];
    requiredBodyTerms?: string[];
    requiredClaims?: RequiredClaim[];
    forbiddenBodyTerms?: string[];
    maxLatencyMs?: number;
  };
};

export type CandidateEvalSuite = {
  schemaVersion: "1.0";
  cases: CandidateEvalCase[];
};

export type CandidateEvalSuiteSummary = {
  totalCases: number;
  candidateCases: number;
  sampleCases: number;
  expectedKinds: Record<DecisionKind, number>;
  repeatedClusters: number;
  candidateDefinedCases: number;
  coveredRiskTags: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateTrustedProfileSurface(input: unknown): string[] {
  if (!isRecord(input) || !Array.isArray(input.profiles)) {
    return ["profile registry response must contain a profiles array"];
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of input.profiles) {
    if (!isRecord(row) || !nonEmpty(row.profileId)) {
      errors.push("profile registry contains an invalid row");
      continue;
    }
    const profileId = row.profileId.trim();
    if (seen.has(profileId)) errors.push(`profile registry repeats profileId: ${profileId}`);
    seen.add(profileId);
    const trusted = trustedProfiles.get(profileId);
    if (!trusted) {
      errors.push(`profile registry exposes unknown profileId: ${profileId}`);
      continue;
    }
    for (const axis of PROFILE_AXES) {
      if (row[axis] !== trusted[axis]) {
        errors.push(`profile registry profile ${profileId} does not match pinned ${axis}`);
      }
    }
  }
  for (const profileId of trustedProfiles.keys()) {
    if (!seen.has(profileId)) errors.push(`profile registry is missing pinned profileId: ${profileId}`);
  }
  return [...new Set(errors)];
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

function requiredClaims(value: unknown): value is RequiredClaim[] {
  return Array.isArray(value) && value.length > 0 && value.every((claim) => (
    isRecord(claim) &&
    nonEmpty(claim.bodyTerm) &&
    stringArray(claim.sourceIds) && claim.sourceIds.length > 0 &&
    stringArray(claim.quoteTerms) && claim.quoteTerms.length > 0
  ));
}

export function validateCandidateEvalSuite(input: unknown): {
  errors: string[];
  suite: CandidateEvalSuite | null;
  summary: CandidateEvalSuiteSummary;
} {
  const errors: string[] = [];
  const emptySummary: CandidateEvalSuiteSummary = {
    totalCases: 0,
    candidateCases: 0,
    sampleCases: 0,
    expectedKinds: { answer: 0, defer: 0, conversational: 0 },
    repeatedClusters: 0,
    candidateDefinedCases: 0,
    coveredRiskTags: [],
  };

  if (!isRecord(input)) return { errors: ["suite must be a JSON object"], suite: null, summary: emptySummary };
  if (input.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
  if (!Array.isArray(input.cases)) return { errors: [...errors, "cases must be an array"], suite: null, summary: emptySummary };
  if (input.cases.length > MAX_TOTAL_EVAL_CASES) errors.push(`suite may contain at most ${MAX_TOTAL_EVAL_CASES} total cases`);

  const ids = new Set<string>();
  const parsedCases: CandidateEvalCase[] = [];
  for (const [index, value] of input.cases.entries()) {
    const prefix = `cases[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const expected = isRecord(value.expected) ? value.expected : {};
    const id = nonEmpty(value.id) ? value.id.trim() : "";
    const kind = nonEmpty(expected.kind) && DECISION_KINDS.includes(expected.kind as DecisionKind)
      ? expected.kind as DecisionKind
      : null;
    const tags = stringArray(value.tags) ? value.tags.map((tag) => tag.trim()) : [];

    if (value.sample !== undefined && typeof value.sample !== "boolean") errors.push(`${prefix}.sample must be boolean`);
    if (!id) errors.push(`${prefix}.id is required`);
    else if (ids.has(id)) errors.push(`${prefix}.id must be unique: ${id}`);
    else ids.add(id);
    if (!nonEmpty(value.objective) || value.objective.trim().length < 20) errors.push(`${prefix}.objective must explain the risk being tested`);
    if (!nonEmpty(value.clusterId)) errors.push(`${prefix}.clusterId is required`);
    if (!nonEmpty(value.profileId)) errors.push(`${prefix}.profileId is required`);
    if (!nonEmpty(value.question)) errors.push(`${prefix}.question is required`);
    else if (value.question.length > 12_000) errors.push(`${prefix}.question must be at most 12000 characters`);
    if (!nonEmpty(value.asOf) || Number.isNaN(Date.parse(value.asOf))) errors.push(`${prefix}.asOf must be an ISO date or datetime`);
    if (tags.length === 0) errors.push(`${prefix}.tags must contain at least one tag`);
    if (!kind) errors.push(`${prefix}.expected.kind must be answer, defer, or conversational`);
    else if (!tags.includes(kind)) errors.push(`${prefix}.tags must include ${kind}`);

    if (value.history !== undefined) {
      if (!Array.isArray(value.history) || value.history.length > 20 || value.history.some((turn) => !isRecord(turn) || !["user", "assistant"].includes(String(turn.role)) || !nonEmpty(turn.content))) {
        errors.push(`${prefix}.history must contain valid user or assistant turns`);
      }
    }

    if (kind === "answer") {
      if (!stringArray(expected.requiredSourceIds) || expected.requiredSourceIds.length === 0) {
        errors.push(`${prefix}.expected.requiredSourceIds is required for an answer`);
      }
      if (!stringArray(expected.requiredBodyTerms) || expected.requiredBodyTerms.length === 0) {
        errors.push(`${prefix}.expected.requiredBodyTerms is required for an answer`);
      }
      if (!requiredClaims(expected.requiredClaims)) {
        errors.push(`${prefix}.expected.requiredClaims must map body terms to source IDs and quote terms`);
      } else if (stringArray(expected.requiredBodyTerms)) {
        const claimTerms = expected.requiredClaims.map((claim) => claim.bodyTerm.normalize("NFKC").toLocaleLowerCase("pt-BR"));
        for (const term of expected.requiredBodyTerms) {
          if (!claimTerms.some((claimTerm) => claimTerm.includes(term.normalize("NFKC").toLocaleLowerCase("pt-BR")) || term.normalize("NFKC").toLocaleLowerCase("pt-BR").includes(claimTerm))) {
            errors.push(`${prefix}.expected.requiredClaims does not cover body term: ${term}`);
          }
        }
      }
    }
    if (kind === "defer" && (!nonEmpty(expected.reasonCode) || !DEFER_REASONS.includes(expected.reasonCode as (typeof DEFER_REASONS)[number]))) {
      errors.push(`${prefix}.expected.reasonCode must be a public defer reason`);
    }
    if (expected.forbiddenBodyTerms !== undefined && !stringArray(expected.forbiddenBodyTerms)) {
      errors.push(`${prefix}.expected.forbiddenBodyTerms must be an array of strings`);
    }
    if (expected.maxLatencyMs !== undefined && (!Number.isFinite(expected.maxLatencyMs) || Number(expected.maxLatencyMs) < 1)) {
      errors.push(`${prefix}.expected.maxLatencyMs must be positive`);
    }

    if (id && kind && nonEmpty(value.objective) && nonEmpty(value.clusterId) && nonEmpty(value.profileId) && nonEmpty(value.question) && nonEmpty(value.asOf)) {
      parsedCases.push(value as CandidateEvalCase);
    }
  }

  const candidateCases = parsedCases.filter((testCase) => testCase.sample !== true);
  if (candidateCases.length > MAX_CANDIDATE_CASES) errors.push(`suite may contain at most ${MAX_CANDIDATE_CASES} non-sample cases`);
  const expectedKinds: Record<DecisionKind, number> = { answer: 0, defer: 0, conversational: 0 };
  const coveredTags = new Set<string>();
  const clusters = new Map<string, Set<string>>();
  const casesByCluster = new Map<string, CandidateEvalCase[]>();
  const candidateDefinedTags = new Map<string, number>();
  const riskCounts = new Map<string, number>();
  const answerSourceIds = new Set<string>();
  for (const testCase of candidateCases) {
    expectedKinds[testCase.expected.kind] += 1;
    const normalizedTags = testCase.tags.map((tag) => tag.trim());
    normalizedTags.forEach((tag) => coveredTags.add(tag));
    for (const tag of REQUIRED_RISK_TAGS) {
      if (normalizedTags.includes(tag)) riskCounts.set(tag, (riskCounts.get(tag) ?? 0) + 1);
    }
    const requiredRiskCount = normalizedTags.filter((tag) => REQUIRED_RISK_TAGS.includes(tag as (typeof REQUIRED_RISK_TAGS)[number])).length;
    if (requiredRiskCount > 2) errors.push(`case ${testCase.id} may carry at most 2 required risk tags`);
    for (const tag of normalizedTags) {
      if (!DECISION_KINDS.includes(tag as DecisionKind) && !REQUIRED_RISK_TAGS.includes(tag as (typeof REQUIRED_RISK_TAGS)[number])) {
        candidateDefinedTags.set(tag, (candidateDefinedTags.get(tag) ?? 0) + 1);
      }
    }
    const clusterQuestions = clusters.get(testCase.clusterId) ?? new Set<string>();
    clusterQuestions.add(testCase.question.normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim());
    clusters.set(testCase.clusterId, clusterQuestions);
    const clusterCases = casesByCluster.get(testCase.clusterId) ?? [];
    clusterCases.push(testCase);
    casesByCluster.set(testCase.clusterId, clusterCases);

    const requiredSourceIds = testCase.expected.requiredSourceIds ?? [];
    requiredSourceIds.forEach((sourceId) => answerSourceIds.add(sourceId));
    if (new Set(requiredSourceIds).size !== requiredSourceIds.length) errors.push(`case ${testCase.id} repeats an expected source ID`);
    if (normalizedTags.includes("multi_source") && (testCase.expected.kind !== "answer" || requiredSourceIds.length < 2)) {
      errors.push(`case ${testCase.id} tags multi_source without requiring an answer from at least 2 sources`);
    }
    if (normalizedTags.includes("governance") && (testCase.expected.kind !== "defer" || !["conflicting_source", "profile_mismatch", "validation_pending", "policy_sensitive_source"].includes(testCase.expected.reasonCode ?? ""))) {
      errors.push(`case ${testCase.id} tags governance without a governance-specific deferral`);
    }
    if (normalizedTags.includes("missing_evidence") && (testCase.expected.kind !== "defer" || testCase.expected.reasonCode !== "missing_source")) {
      errors.push(`case ${testCase.id} tags missing_evidence without a missing_source deferral`);
    }
    if (normalizedTags.includes("privacy_or_injection") && (testCase.expected.kind !== "defer" || !["sensitive_topic", "profile_mismatch", "policy_sensitive_source"].includes(testCase.expected.reasonCode ?? ""))) {
      errors.push(`case ${testCase.id} tags privacy_or_injection without a privacy-safe deferral`);
    }
  }
  const repeatedClusters = [...clusters.values()].filter((questions) => questions.size >= 2).length;
  const candidateDefinedCases = Math.max(0, ...candidateDefinedTags.values());

  if (candidateCases.length < MIN_CANDIDATE_CASES) errors.push(`add at least ${MIN_CANDIDATE_CASES} non-sample cases`);
  if (expectedKinds.answer < 4) errors.push("candidate suite needs at least 4 answer cases");
  if (expectedKinds.defer < 4) errors.push("candidate suite needs at least 4 defer cases");
  if (expectedKinds.conversational < 1) errors.push("candidate suite needs at least 1 conversational case");
  for (const tag of REQUIRED_RISK_TAGS) {
    if ((riskCounts.get(tag) ?? 0) < 2) errors.push(`candidate suite needs at least 2 mechanically valid cases for risk tag: ${tag}`);
  }
  for (const testCase of candidateCases.filter((item) => item.tags.includes("paraphrase_or_boundary"))) {
    if ((clusters.get(testCase.clusterId)?.size ?? 0) < 2) errors.push(`case ${testCase.id} tags paraphrase_or_boundary without a distinct paired question`);
  }
  for (const testCase of candidateCases.filter((item) => item.tags.includes("counterfactual_boundary"))) {
    const pair = casesByCluster.get(testCase.clusterId) ?? [];
    const firstProfile = pair.length === 2 ? trustedProfiles.get(pair[0].profileId) : undefined;
    const secondProfile = pair.length === 2 ? trustedProfiles.get(pair[1].profileId) : undefined;
    const changedProfileAxes = firstProfile && secondProfile
      ? PROFILE_AXES.filter((axis) => firstProfile[axis] !== secondProfile[axis])
      : [];
    const changesExactlyOneTrustedProfileAxis =
      pair.length === 2 &&
      pair[0].profileId !== pair[1].profileId &&
      pair[0].asOf === pair[1].asOf &&
      Boolean(firstProfile) &&
      Boolean(secondProfile) &&
      changedProfileAxes.length === 1;
    const changesOnlyDate =
      pair.length === 2 &&
      pair[0].profileId === pair[1].profileId &&
      pair[0].asOf !== pair[1].asOf;
    const validPair = pair.length === 2 && pair.every((item) => item.tags.includes("counterfactual_boundary")) &&
      pair[0].question.normalize("NFKC") === pair[1].question.normalize("NFKC") &&
      JSON.stringify(pair[0].history ?? []) === JSON.stringify(pair[1].history ?? []) &&
      pair[0].expected.kind !== pair[1].expected.kind &&
      (changesExactlyOneTrustedProfileAxis || changesOnlyDate);
    if (!validPair) errors.push(`case ${testCase.id} tags counterfactual_boundary without an answer/defer pair that changes exactly one trusted profile axis or only asOf`);
  }
  if (answerSourceIds.size < 4) errors.push("candidate answer cases must exercise at least 4 distinct source IDs");
  if (candidateDefinedCases < 2) errors.push("candidate suite needs at least 2 cases for a candidate-defined risk");
  if (repeatedClusters < 2) errors.push("candidate suite needs at least 2 clusters with repeated or paraphrased cases");

  return {
    errors,
    suite: { schemaVersion: "1.0", cases: parsedCases },
    summary: {
      totalCases: parsedCases.length,
      candidateCases: candidateCases.length,
      sampleCases: parsedCases.length - candidateCases.length,
      expectedKinds,
      repeatedClusters,
      candidateDefinedCases,
      coveredRiskTags: [...coveredTags].sort(),
    },
  };
}
