# Candidate evals

The two sample cases show the file shape. They are not a benchmark and do not satisfy the submission gate.

Add 12 to 48 non-sample cases that test decisions you believe the client cannot afford to get wrong. Your suite must include:

- at least four supported answers, with required source IDs and body facts;
- at least four deferrals, with the expected public reason;
- at least one conversational request;
- repeated or paraphrased clusters for at least two underlying facts;
- at least two mechanically valid cases each for multi-source answers, governance, missing evidence, privacy or injection, and paraphrase or boundary behavior;
- one two-case `counterfactual_boundary` cluster: identical question and history, opposite answer/defer outcome, and exactly one changed input axis. A date pair changes only `asOf`; a profile pair must resolve to trusted profile rows that differ on exactly one of `legalEntityId`, `baseId`, `relationship`, or `role`;
- at least two cases for a material risk from your diagnosis that is not named above. Give it your own tag.

The JSON suite exercises decisions. Your `EVAL_REPORT.md` must add one end-to-end handoff lifecycle check: create a deferral, repeat the same logical request, retrieve the ticket, resolve it, and prove that the original context survived without a duplicate. Also report the safe behavior you observed when the optional model provider was unavailable. You may automate those checks in the runner or in your test suite.

Tags are not self-attestation. The validator checks what the case actually expects:

- `multi_source` is an answer that requires at least two distinct source IDs;
- `governance` is a governance-specific deferral;
- `missing_evidence` is a `missing_source` deferral;
- `privacy_or_injection` is a privacy-safe deferral;
- `paraphrase_or_boundary` belongs to a cluster with a second, distinct question.
- `counterfactual_boundary` belongs to a two-case answer/defer cluster with identical language and only one date or trusted-profile axis changed. Merely swapping two profile IDs is not enough.

Each required risk needs two cases, no case may carry more than two required risk tags, answer cases must span at least four source IDs and three source domains, and repeated clusters must contain genuinely different questions.

For every answer fact, map the body term to acceptable evidence and the words the cited quote must contain:

```json
{
  "requiredBodyTerms": ["35 dias"],
  "requiredSourceIds": ["source-policy", "source-process"],
  "requiredClaims": [
    {
      "bodyTerm": "35 dias",
      "sourceIds": ["source-policy"],
      "quoteTerms": ["35 dias corridos"]
    }
  ]
}
```

The runner verifies that the body fact appears in a material claim and that the claim cites an exact eligible quote containing the expected support. A nearby citation is not enough.

Start your service, then run:

```bash
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
```

The runner writes `/tmp/candidate-eval-report.json` by default; set `CANDIDATE_EVAL_REPORT_PATH` when you want it elsewhere. It exits nonzero only when the suite cannot complete. Individual case failures remain in the report and do not turn an honest run into an execution error. The starter is intentionally incomplete, so its first run should fail with clear suite errors.

The hiring runner invokes `node evals/run.ts` in bare Node 24 with the submission mounted read-only, no `node_modules`, and no public network. You may change the runner, but it must use only Node built-ins and local submission files.

Summarize the exact totals in `EVAL_REPORT.md`, including failed cases. Name the extra risk you chose, justify why it matters to your diagnosis, and map its tag to the relevant cases. Explain what the suite covers, false answers and false deferrals you found, threshold choices, and the next cases you would add. The hiring runner verifies your report artifact against an authoritative run and requires at least half of the authored cases to pass; this prevents an empty or wholly broken suite while preserving real failures. Do not claim that a passing local suite predicts the sealed score.
