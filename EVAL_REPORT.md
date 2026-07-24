# Evaluation report

## Run

Command:

```bash
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
```

Authoritative local run on 2026-07-24: **21 cases, 21 passed, 0 failed, 100% pass rate, execution complete**. This does not predict the sealed score.

The suite contains 12 answers, 8 deferrals, and 1 conversational case. It covers seven answer sources across payroll, vacation, personal data, admission, health and safety, and collective rules. Six clusters repeat or paraphrase facts.

## Risk design

Cases cover exact evidence, multi-source compound questions, conflicting approved sources, stale/scope boundaries, unsupported near-matches, sensitive individual state, prompt/source injection, paraphrases, trusted relationship changes, and explicit human routing.

The candidate-defined risk is `state_not_completion`. Discovery showed that analysts must distinguish requested, received, validated, approved, processed, and completed states. `payroll-provisional-is-not-payment`, `vacation-submission-is-not-approval`, and `vacation-submission-contextual-followup` verify that the service does not turn an intermediate state into a completed outcome, including when the vacation topic is supplied by a prior user turn.

The counterfactual pair asks the identical Sul overtime-percentage question at the same instant. An employee is answered from `na-agreement-coast-2025`; changing only relationship to apprentice produces `defer`.

## Failures and changes

The final authored run had no failed cases, observed false answers, or observed false deferrals. During development, an unsafe false answer materially changed the system: “Existe auxílio para internet?” retrieved the collective meal-support clause because “auxílio” expanded to “apoio.” The fix added per-query concept coverage, preventing an answer when a material query concept such as “internet” is unsupported. Both internet and certification allowances remain regression cases.

Development also exposed:

- a relationship-specific admission question initially selected the apprentice paragraph; Markdown headings are now weighted and kept with their paragraphs;
- a referential meal-support follow-up was split incorrectly at the adverb “também”; contextual matching now preserves that sentence and maps work-status wording to the cited eligibility condition;
- the starter stored traces only in memory; traces are now atomic durable files;
- timekeeping and termination questions initially risked choosing one approved source; numeric, polarity, and timing conflict checks now force `conflicting_source`.

Thresholds are intentionally conservative: a passage needs a BM25-style score of at least 2.35 and at least 60% subject-term coverage. A second claim is allowed only for an explicit compound question, a distinct source, sufficient relative score, and at least 25% coverage. A dominant ineligible source prevents a weaker generic source from answering.

## Handoff lifecycle evidence

Automated tests and the real browser flow verify:

1. an explicit human request creates an open record before the defer response;
2. replaying the same request ID and reason reuses the ticket and idempotency key;
3. the record preserves question, full trusted requester context, history, gap, owner, SLA, trace, and next action;
4. the browser retrieves the record and resolves it with an operator and summary;
5. repeated resolution returns the canonical result;
6. a separate Node process retrieves the record from the same state path.

No duplicate work record was observed.

## Retrieval-mode matrix

The frozen suite is run in both learned and deterministic modes with `npm run evals:matrix`. Both modes must complete all 21 cases without unsafe answers, start within 180 seconds, and return the first post-readiness decision within 10 seconds. Learned retrieval is selected only when it improves frozen paraphrase coverage without reducing safety. Otherwise the runtime defaults to deterministic retrieval and keeps E5 as an opt-in adapter.

Measured locally on 2026-07-24: deterministic readiness took **659 ms** and its first post-readiness decision took **50 ms**; learned readiness, including model warm-up, took **34.2 s** and its first post-readiness decision took **89 ms**. Both modes passed 21/21. Learned retrieval added no frozen-suite coverage, so deterministic retrieval is the selected default.

The final prebuilt restricted image separately reached `ready_degraded` in **846 ms** with a **114 ms** first decision, and `ready_learned` in **2.78 s** with a **154 ms** first decision. Those container measurements include index validation and model warm-up against the immutable bundled artifacts.

The trace exposes learned-provider state as `ok` or `degraded`. Model absence or corruption produces `ready_degraded`; governance, conflicts, claims, citations, routing, and handoffs remain available.

## Next cases

Before production feedback, add typo-heavy Portuguese, compound questions with exactly one unsupported part, more date-only/timestamp boundaries, explicit supersession fixtures, concurrent container processes, and labeled admission journeys. Corrupt-state recovery, three-turn context, assistant-history injection, and real-browser operational flows are now permanent regressions. Keep any future failures; do not delete them to improve a headline rate.
