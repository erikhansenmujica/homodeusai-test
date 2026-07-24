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

The final learned run had no failed cases, observed false answers, or observed false deferrals. During development, an unsafe false answer materially changed the system: an unsupported internet allowance borrowed the meal-support clause. The fix replaced language-specific expansion and topic lists with semantic retrieval concepts, answer alignment, and open-set abstention. Internet and certification allowances remain permanent regressions.

Development also exposed:

- a relationship-specific admission question initially selected the apprentice paragraph; Markdown headings are now weighted and kept with their paragraphs;
- a referential meal-support follow-up was split incorrectly at the adverb “também”; contextual matching now preserves that sentence and maps work-status wording to the cited eligibility condition;
- the starter stored traces only in memory; traces are now atomic durable files;
- timekeeping and termination questions initially risked choosing one approved source; numeric, polarity, and timing conflict checks now force `conflicting_source`.

Thresholds are intentionally conservative: lexical-only support needs a BM25-style score of at least 2.35 and at least 60% subject-term coverage; learned support needs calibrated semantic topic and answer alignment. A second claim is allowed only for a semantically classified compound question and a distinct source covering a different answer shape. An ineligible or conceptually mismatched source cannot be rescued by raw similarity.

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

The frozen suite is run in both learned and degraded modes with `npm run evals:matrix`. Both modes must complete all 21 cases without unsupported autonomous answers, start within 180 seconds, and return the first post-readiness decision within 10 seconds. Exact outcome coverage and safety are reported separately: a conservative defer is safe degradation, not a correct outcome. Learned retrieval is selected only when it improves coverage without reducing safety.

Measured locally on 2026-07-24: degraded readiness took **1.03 s** and its first post-readiness decision took **125 ms**; it matched **9/21** exact outcomes and safely abstained on the remainder. Learned readiness, including model/index validation and warm-up, took **4.59 s** and its first post-readiness decision took **181 ms**; it passed **21/21**. In the restricted Node 24 container, learned readiness took **20.58 s** and the first decision took **0.93 s**. Both modes had zero unsupported autonomous answers, so learned retrieval is the selected default.

The trace exposes learned-provider state as `ok` or `degraded`. Model absence or corruption produces `ready_degraded`; governance, conflicts, claims, citations, routing, and handoffs remain available.

## Next cases

Before production feedback, add typo-heavy and code-switched language, compound questions with exactly one unsupported part, more date-only/timestamp boundaries, explicit supersession fixtures, concurrent container processes, and labeled admission journeys. Corrupt-state recovery, multilingual paraphrases, three-turn context, assistant-history injection, and real-browser operational flows are now permanent regressions. Keep any future failures; do not delete them to improve a headline rate.
