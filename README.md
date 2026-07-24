# Grounding Gauntlet | Nexo Atlântico

Nexo Atlântico’s People Operations team does not need another FAQ bot. Requests arrive through disconnected channels, the rules live in documents with different authority and scope, and analysts reconstruct each case across several systems. Finding a relevant paragraph is only the beginning: someone still has to decide whether it applies to this person, on this date, and whether another source overrides it.

When the record is incomplete, the current fallback is just as costly. Context disappears between teams, the employee repeats the request, and the case reopens. An internal email-and-FAQ assistant already covers part of the flow, so a second chatbot would duplicate work without fixing the operating problem.

Your job is to understand that business problem, build the strongest governed RAG decision system you can, evaluate it against the failures the client cannot afford, and present a rollout recommendation.

## The engagement

You have 16 implementation hours within two calendar days — the submission is due 2 days after your confirmed start. In that time you must:

1. Diagnose the client’s pain from session notes, service measurements, and noisy request journeys. Separate observations from assumptions.
2. Build one container with a decision service and a finished browser interface. It must answer from eligible evidence, defer safely when the record is not enough, and leave a human an owned case they can continue.
3. Design and run your own eval suite. Test the boundaries you found instead of writing cases that only confirm your implementation.
4. Present what you learned, what you built, what failed, and what the client should do next.

The build target is fixed: a governed RAG decision service over the anonymized FAQ and policy corpus, answering the employee questions People Operations receives today. It sounds simple, and that is the point — retrieval quality alone is not the product. A plausible passage can still be stale, pending, restricted, scoped to another employee, contradicted by another eligible source, or insufficient for the whole question. The assignment is surviving production governance, and your readout must defend the pilot scope boundary, its exclusions, and the rollout.

The challenge ends in three parts against the same submitted commit: technical evals, a 15-minute client presentation, and a live operator design check. In the third part, the reviewer acts as a People Operations operator and uses your frontend without you driving it. The interface must be both operationally complete and deliberately designed.

## Start with the terminal

```bash
npm ci
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) and type `help`. The terminal contains the full case briefing. Follow this sequence:

```text
problem -> evidence -> workflow -> data -> mandate -> constraints -> evals -> deliver
```

If you received only the hosted terminal, `download` returns the complete history-free candidate kit. Verify it against `/candidate-kit.tgz.sha256`. The private organizer repository, sealed cases, gold labels, scoring weights, and reference approaches are not included.

## Checks

Run these once before changing the starter to verify the kit:

```bash
npm run typecheck
npm test
npm run self-check
```

The shipped tests describe starter behavior and safety primitives. Replace or extend starter-specific assertions as your product changes. Keep `npm run typecheck`, your final tests, and `npm run self-check` green; the self-check accepts either the untouched two-case eval sample or a structurally complete candidate suite.

The two shipped eval cases document the format; they do not form a passing suite. Start your service, author your cases, then run:

```bash
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
```

## What is in the kit

```text
CASE.md                              full business case and assignment
case-data/client-discovery/          session evidence, metrics, and request journeys
case-data/client-discovery/admission-case-snapshot.json
                                      unlabeled workflow state and exceptions
case-data/source-documents.json      governed answer corpus
case-data/manifest.json              source governance and ingestion metadata
case-data/actors/profiles.json       requester contexts
case-data/operations/                human-handoff policy
case-data/registry/                  deliberately incomplete source register
case-data/sources/                   normalized source files
CONTRACT.md                          locked service and browser contract
EVALUATION.md                        review model and hard gates
evals/                               candidate-owned eval starter
SUBMISSION.md                        handoff and client presentation
```

The package is synthetic and anonymized. Its source envelope preserves the production-shaped delivery: 22 files normalized into 34 governed sources, including 13 FAQ categories and 269 rows. It does not distribute client text, identities, vendor topology, source-file lengths, or recoverable transcript language.

## Implemented submission

The finished desk preserves the locked API and browser hooks while adding truthful runtime readiness, deterministic-by-default retrieval with an optional checksum-pinned E5 adapter, exact extractive evidence, three-turn user-only follow-up context, durable idempotent handoffs, bounded redacted traces, metrics/logging, accessible internal source navigation, and real Playwright coverage.

The authored evaluation has **21 cases** (12 answers, 8 deferrals, 1 conversation) and the answer gate requires at least **60% subject-term coverage**. The final local A/B passed 21/21 in both modes: deterministic readiness/first decision measured 659/50 ms; learned measured 34.2 s/89 ms. The final prebuilt restricted image measured 846/114 ms in deterministic mode and 2.78 s/154 ms in learned mode. Because E5 added no frozen-suite coverage, deterministic retrieval is the default. Provider state is reported as `ok` or `degraded`.

See [RUNBOOK.md](./RUNBOOK.md) for startup, readiness, model, restricted-container, and incident procedures. `npm run export:candidate` refuses a dirty tree and archives only the exact tracked commit.
