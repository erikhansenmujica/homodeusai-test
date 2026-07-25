export const DOMAIN_CONFIG_VERSION = "people-ops-v2";

export const RETRIEVAL_LIMITS = {
  minimumRelevance: 2.35,
  minimumTopicCoverage: 0.6,
  // Keep expansion corroboration inside the high-signal lexical head instead of treating deep recall as support.
  maximumLexicalCorroborationCandidates: 12,
  maximumGovernedCandidates: 160,
} as const;

export function assertDomainConfigValid(): void {
  if (!/^people-ops-v\d+$/u.test(DOMAIN_CONFIG_VERSION)) throw new Error("domain configuration version is invalid");
  // Reject invalid thresholds and any corroboration window wider than the governed candidate budget.
  if (
    RETRIEVAL_LIMITS.minimumRelevance <= 0
    || RETRIEVAL_LIMITS.minimumTopicCoverage <= 0
    || RETRIEVAL_LIMITS.minimumTopicCoverage > 1
    || RETRIEVAL_LIMITS.maximumLexicalCorroborationCandidates < 1
    || RETRIEVAL_LIMITS.maximumLexicalCorroborationCandidates
      > RETRIEVAL_LIMITS.maximumGovernedCandidates
    || RETRIEVAL_LIMITS.maximumGovernedCandidates < 1
  ) {
    throw new Error("retrieval limits are invalid");
  }
}
