# Evaluation report

## Run

Command:

```bash
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
```

Authoritative local run on 2026-07-24: **20 cases, 20 passed, 0 failed, 100% pass rate, execution complete**. This does not predict the sealed score.

The suite contains 11 answers, 8 deferrals, and 1 conversational case. It covers seven answer sources across payroll, vacation, personal data, admission, health and safety, and collective rules. Six clusters repeat or paraphrase facts.

## Risk design

Cases cover exact evidence, multi-source compound questions, conflicting approved sources, stale/scope boundaries, unsupported near-matches, sensitive individual state, prompt/source injection, paraphrases, trusted relationship changes, and explicit human routing.

The candidate-defined risk is `state_not_completion`. Discovery showed that analysts must distinguish requested, received, validated, approved, processed, and completed states. `payroll-provisional-is-not-payment`, `vacation-submission-is-not-approval`, and `vacation-submission-contextual-followup` verify that the service does not turn an intermediate state into a completed outcome, including when the vacation topic is supplied by a prior user turn.

The counterfactual pair asks the identical Sul overtime-percentage question at the same instant. An employee is answered from `na-agreement-coast-2025`; changing only relationship to apprentice produces `defer`.

## Failures and changes

The final authored run had no failed cases, observed false answers, or observed false deferrals. During development, an unsafe false answer materially changed the system: “Existe auxílio para internet?” retrieved the collective meal-support clause because “auxílio” expanded to “apoio.” The fix added per-query concept coverage, preventing an answer when a material query concept such as “internet” is unsupported. Both internet and certification allowances remain regression cases.

Development also exposed:

- a relationship-specific admission question initially selected the apprentice paragraph; Markdown headings are now weighted and kept with their paragraphs;
- the starter stored traces only in memory; traces are now atomic durable files;
- timekeeping and termination questions initially risked choosing one approved source; numeric, polarity, and timing conflict checks now force `conflicting_source`.

Thresholds are intentionally conservative: a passage needs a BM25-style score of at least 2.35 and at least 52% query-concept coverage. A second claim is allowed only for an explicit compound question, a distinct source, sufficient relative score, and at least 25% coverage. A dominant ineligible source prevents a weaker generic source from answering.

## Handoff lifecycle evidence

Automated tests and the real browser flow verify:

1. an explicit human request creates an open record before the defer response;
2. replaying the same request ID and reason reuses the ticket and idempotency key;
3. the record preserves question, full trusted requester context, history, gap, owner, SLA, trace, and next action;
4. the browser retrieves the record and resolves it with an operator and summary;
5. repeated resolution returns the canonical result;
6. a separate Node process retrieves the record from the same state path.

No duplicate work record was observed.

## Provider-unavailable behavior

The optional provider was absent. The service started, became ready, and completed every case deterministically. Traces reported `provider.status: "not_used"`. No provider output is needed for eligibility, conflicts, claims, citations, routing, or handoffs, so an absent or failing proxy cannot produce a 500 in this version.

## Next cases

Before production feedback, add typo-heavy Portuguese, longer conversation history, compound questions with exactly one unsupported part, more date-only/timestamp boundaries, explicit supersession fixtures, corrupt-state recovery, concurrent container processes, and labeled admission journeys. Keep any failures; do not delete them to improve a headline rate.
