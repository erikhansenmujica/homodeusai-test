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
- timekeeping and termination questions initially risked choosing one approved source; semantic conflict concepts now require multi-authority consensus, while Unicode numeric comparison remains a language-neutral deterministic signal;
- a Linux/x64 percentage question exposed a near-neighbor protected-compensation route and rejection-order drift; protected concepts now require a winning compatible answer shape, and uniform trusted-profile rejection deterministically yields `profile_mismatch`;
- Linux/x64 payroll and declared conflict paraphrases placed the governing sources inside the stable semantic near-top window but behind unrelated direct top passages; those two bounded concept classes can now use a domain-aligned preferred source corroborated inside the top 12 lexical candidates, while deep lexical recall cannot unlock expansion and ordinary policy or agreement concepts retain the stricter direct-top source-type gate;
- the supplied 63-question adversarial matrix initially matched 37/63 expected outcomes; general semantic routing, trusted-context isolation, answer-shape calibration, compound-question boundaries, and conservative authority handling raised it to 63/63 without query-language keyword branches.
- eight later open-world presentation probes exposed false handoffs and one wrong-clause answer around service channels, draft vacation changes, event-date rules, documented exceptions, request-versus-approval, equivalent versions, reconciliation records, and deadline start points. The fixes use generic semantic answer alignment, policy/live-state separation, evidence ranking, and conflict gating; all eight remain regressions without question-text branches.

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

Measured from fresh state locally on 2026-07-25: degraded readiness took **1.078 s** and its first post-readiness decision took **131 ms**; it matched **9/21** exact outcomes and safely abstained on the remainder. Learned readiness, including model/index creation, validation, and warm-up, took **52.95 s** and its first decision took **263 ms**; it passed **21/21**. Both modes had zero unsupported autonomous answers, so learned retrieval is the selected default.

The final Docker image was also built without ignored local assets and started under the submission limits: read-only root, numeric runtime user, no capabilities, no-new-privileges, 256 processes, 2 CPU, and 4 GiB memory. Its bundled index reached `ready_learned` in **13.42 s**; the first client-observed decision took **1.351 s** (**1.220 s** inside the service), below the 10-second restricted-container ceiling. A handoff created on a named state volume remained open and retrievable after the container was removed and recreated.

The trace exposes learned-provider state as `ok` or `degraded`. Model absence or corruption produces `ready_degraded`; governance, conflicts, claims, citations, routing, and handoffs remain available.

## Supplemental adversarial matrix

`npm run test:extended` executes the 63 supplied Portuguese questions as a permanent real-engine regression suite. It checks the expected decision and public reason, required and forbidden answer terms, source identity, exact byte-level evidence, and trace redaction. The final native and Linux/x64 learned runs both passed **63/63**. Direct-question and retrieval-concept similarity are retained independently to stabilize close passage ties across embedding runtimes. Cross-domain FAQ evidence can reject an unrelated concept, concept-based conflict consensus stays anchored to the concept passage set, and typed consensus requires every configured authority class. Fixes remain expressed as versioned multilingual meaning prototypes and generic policy properties rather than branches on those questions or Portuguese synonym, polarity, or timing-word tables.

`tests/open-world-retrieval.test.ts` adds 20 supported corpus questions that are absent from the semantic retrieval concept catalog. The final learned run passed **20/20** with the expected source and byte-valid evidence. The final eight reproduce the presentation-probe failures described above. These cases protect the architectural rule that prototypes may improve recall and enforce safety but do not define the complete set of answerable questions.

The deterministic fallback cannot provide cross-language meaning matching without the multilingual model. It therefore remains language-neutral and abstention-first: on the frozen suite it produced 9 exact outcomes and 12 safe handoffs, with no unsupported answer. This is deliberately measured separately from learned coverage.

## Next cases

Before production feedback, add typo-heavy and code-switched language, compound questions with exactly one unsupported part, more date-only/timestamp boundaries, explicit supersession fixtures, concurrent container processes, and labeled admission journeys. Corrupt-state recovery, multilingual paraphrases, three-turn context, assistant-history injection, and real-browser operational flows are now permanent regressions. Keep any future failures; do not delete them to improve a headline rate.
