# Evaluation

The challenge finishes with three separate reviews of the same submitted commit:

1. **Evals.** Candidate-owned evals show how you define quality. Sealed system and browser evals test behavior you cannot tune against.
2. **Client presentation.** You present the diagnosis, product judgment, eval learning, and recommendation to the client audience.
3. **Live operator design check.** The reviewer acts as a People Operations operator and uses your frontend directly. The first-use pass is unaided: you observe instead of driving the product or narrating where to click.

Each part stands on its own. A result from one part does not erase a failure in another.

The submitted container is built once. That artifact is tested against seeded language, profile, date, and history variants; answer/defer counterfactual twins; conversational boundaries; absent and failing model providers; concurrency; container recreation; and a browser contract. Candidate code cannot read the cases, gold labels, taint ledger, or scoring logic.

## What reviewers inspect

| Dimension | Review question |
|---|---|
| Client diagnosis | Did you find the material pain, stakeholders, constraints, and success measures without pretending the packet was complete? |
| Product judgment | Does the build address the operating diagnosis and the existing internal assistant, or merely demonstrate retrieval? |
| Grounded usefulness | Does it answer completely and correctly when eligible evidence supports an answer? |
| Deferral judgment | Does it avoid both unsafe answers and unnecessary handoffs? |
| Evidence and governance | Are claims tied to exact eligible source bytes, with applicability, authority, validity, audience, and conflict handled? |
| Privacy and injection resistance | Does it resist restricted-content leakage and instructions embedded in user or source text? |
| Human handoff | Can a person understand, own, and complete the deferred request without starting over? |
| Candidate eval design | Do your cases target consequential risks, boundaries, paraphrases, and failure modes rather than a happy-path demo? |
| Reliability | Does the same artifact handle startup, readiness, concurrency, malformed input, latency, and provider failure? |
| Decision desk | Can a reviewer ask, inspect, trace, navigate, recover, and operate a coherent, polished product on desktop and mobile without candidate guidance? |
| Client readout | Does the presentation connect evidence, product choices, overlap with existing capability, eval findings, limitations, and a defensible next step? |

## Hard gates

The following can invalidate a run regardless of answer coverage:

- an answer on a must-defer case;
- fabricated, out-of-bounds, altered, stale, ineligible, or restricted evidence;
- a material claim without supporting eligible evidence;
- personal, restricted, secret, or dynamic canary leakage;
- an invalid response contract;
- an unusable, non-retrievable, non-idempotent, or restart-fragile handoff;
- a handoff that drops any trusted requester field or conversation turn;
- a trace whose ordered retrieval, exact governance counts and source/version set, provider state, or final route does not reconcile with the decision, or one that leaks source text;
- failure of a required production frontend path;
- missing or unreliable service readiness;
- missing or structurally incomplete candidate evals;
- missing client readout or eval report.

The frontend is a production path, not a cosmetic bonus. The browser runner isolates answer, defer, trace, slow, and failure rendering with synthetic probes, then opens a clean page and creates, opens, and completes a human-requested handoff against the submission's real backend. The sandbox separately probes full-context persistence, concurrent creation and resolution, and completion across container recreation. An untouched starter, hidden test-only UI, raw-JSON-only result, receipt-only handoff, or desktop-only layout fails that gate.

After the automated browser gate, the live operator check tests what DOM assertions cannot: first-use clarity, visual hierarchy, evidence legibility, interaction quality, handoff usability, responsive composition, accessibility, and overall craft. The reviewer chooses the questions and operates the submitted product. The exact prompts remain private, but the product should support a normal request, an unsupported or ambiguous request, evidence inspection, and completion of a human handoff without a guided tour.

Eligibility also requires meaningful grounded-answer coverage, bounded unnecessary deferral, conversational accuracy, and correct behavior on every declared counterfactual twin. These are not relaxed by routing everything to a person. Exact thresholds remain sealed until the bank is calibrated.

## Candidate-owned evals

Your suite must contain 12 to 48 non-sample cases, including supported answers, required deferrals, conversational cases, repeated fact clusters, at least one answer/defer counterfactual pair, the required risk coverage, and at least one risk you chose from your diagnosis. Name and justify that extra risk in `EVAL_REPORT.md`, then map it to its cases. See [evals/README.md](./evals/README.md). The runner checks expected decisions, answer facts, source use, exact UTF-8 evidence integrity, handoff identity, trace presence, and optional latency limits. Your report must also show how you verified that a deferred request can be retrieved and completed without losing context or creating duplicate work.

We inspect what you chose to test, what failed, and what you learned. The runner exits successfully when a valid suite completes, even when individual cases fail; the JSON report preserves those failures. A locally passing suite is not evidence that the sealed suite will pass, and deleting a hard case is worse than reporting it.

## Anti-gaming controls

Equivalent questions are grouped before aggregation so repeated paraphrases do not outweigh independent facts. Seeded runtime variants change wording, request identity, time, and trusted context while preserving the oracle. Minimal twins change one decisive profile or date axis and must flip the route. The evaluator makes one attempt per private case and never retries an uncertain result. The same built artifact is used throughout.

Blanket deferral is ineligible because supported-answer coverage and false deferrals are gated. Aggressive answering is worse because unsafe over-answering is a critical violation. Whole-document citations, undeclared factual prose, and restricted-source excerpts also fail.

## What stays sealed

We do not publish private case counts, category mix, prompts, target answers, accepted source sets, weights, score thresholds, taints, or benchmark results. Local checks prove only that the submission can be evaluated. They do not estimate a hiring result.
