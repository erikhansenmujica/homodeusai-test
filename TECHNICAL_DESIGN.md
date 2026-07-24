# Technical Design

## 1. Executive summary

The implemented first version is an offline-capable, deterministic governed decision service. It uses citable passage extraction, an in-memory BM25-style lexical index, source eligibility rules, explicit conflict checks, template answers, exact UTF-8 citations, and durable filesystem handoffs/traces. An LLM is not a critical dependency.

## 2. Goals

- Return `answer`, `defer`, or `conversational` under the locked contract.
- Answer only from exact eligible evidence for the trusted requester and `asOf`.
- Preserve an actionable case when autonomous answering is unsafe.
- Operate in one read-only-root container without public Internet.
- Expose a finished responsive operator desk and runnable candidate eval suite.

## 3. Non-goals

Embeddings, a vector database, microservices, write integrations, admission decisions, live personal state, clinical or financial calculation, production multi-tenancy, and autonomous model judgment are excluded.

## 4. Current repository assessment

The starter already supplied strict public types, request/decision validation, corpus hash verification, UTF-8 evidence helpers, API routes, an idempotent handoff example, Docker constraints, and an eval runner using Node built-ins. Placeholders were the defer-all decision policy, memory-only traces, starter terminal, and two sample evals. The implementation preserves the trustworthy primitives and replaces those placeholders.

## 5. Functional requirements

The service validates trusted context, classifies non-policy conversation, retrieves passages, filters governance, detects supersession/conflicts, renders claims and citations, persists traces, creates/reuses/resolves handoffs, and serves profiles/corpus metadata. The UI supports request, history, evidence-to-source navigation, trace inspection, and full human completion.

## 6. Non-functional requirements

Startup is under 180 seconds; normal decisions are expected under 10 seconds; responses stay below 256 KiB; state survives container recreation; the process runs as `65532:65532`; and no required path depends on Internet or the optional provider.

## 7. Proposed architecture

```text
HTTP -> validation -> intent boundary -> lexical retrieval
     -> governance -> supersession -> conflicts
     -> answer | defer + handoff | conversational
     -> trace persistence -> JSON/UI
```

Modules are `contract`, `corpus`, `retrieval`, `governance`, `decide`, `evidence`, `queue`, `traces`, `server`, and `ui`.

## 8. Request lifecycle

Malformed input returns typed `400`. Conversational and explicit-human routes short-circuit safely. Other requests retrieve at most 48 passages, govern the best 28 passages without premature source deduplication, rerank eligible passages, detect conflicts, and select at most two answer passages. A defer persists its work record before response completion. Every valid decision has a retrievable redacted trace.

## 9. Domain model

Existing `Decision`, `DecideRequest`, `SourceDocument`, evidence, handoff, and trace types are reused. `Passage`, `RetrievalCandidate`, `EligibilityResult`, `EligibilityRejection`, `Conflict`, and `RetrievalRun` extend `src/types.ts`. Discriminated unions represent decisions and eligibility.

## 10. Retrieval design

FAQ rows, Markdown paragraphs under headings, collective clauses, and process blocks are citation units with stable character and UTF-8 byte ranges. Synthetic `CENÁRIO_OPERACIONAL` records are excluded because they are generated test noise rather than approved guidance. Text is NFKD-normalized, diacritics removed for matching, lowercased, tokenized, and filtered through a small Portuguese/English stopword list. No stemming is used; bounded synonym groups cover high-value corpus language. Titles, headings, and bodies receive distinct BM25-style weights. After governance, deterministic requirement checks (percentage, currency, duration, list, event, boolean, individual-state, or general rule) plus authority and scope specificity rerank candidates. The index is small enough to build in memory.

Controlled query concepts add downweighted terms for timekeeping marks, overtime compensation, internship instruments, termination initiation, mandatory human review, and meal support. Explicit query-region aliases take precedence over the requester base for source lookup (`question → profile → source metadata`); that lookup scope does not assert personal applicability. The trace records the resolved scope and any rejected regional source.

## 11. Governance design

`evaluateEligibility(source, request, activeSuperseders)` checks, in order: approval, employee audience, high sensitivity, future validity, inclusive end validity, legal entity, base, relationship, role, and active supersession. Rejections are traceable codes. Rejected/internal/high/pending sources may affect routing but never claims.

## 12. Conflict and precedence resolution

An effective approved source’s explicit `supersedes` list removes the older record. Authority tier ranks but does not erase disagreement. Relevant eligible sources are compared for incompatible numeric/ordinal values, opposed polarity, and opposed timing. Scope differences are removed by eligibility before comparison. A detected material conflict yields `conflicting_source`.

## 13. Decision logic

`answer` requires sufficient score, query-concept coverage, an answer passage that satisfies the requested answer type, eligible evidence, no conflict, and valid citations. Source deduplication happens only after passage reranking. A second source is included only for explicit compound language. `defer` handles human request, missing/low evidence, scope mismatch, pending/stale source, protected source, conflict, sensitive individual state, and injection; expired applicable sources produce an explained missing-source defer. `conversational` is limited to greetings and thanks without a policy request.

## 14. Evidence and citations

The selected answer substring is located inside exact corpus content. The prefix byte length becomes `startByte`; quote byte length determines `endByte`; SHA-256 hashes the quote bytes. Tests round-trip multibyte Portuguese through `Buffer.from(content, "utf8").subarray(start, end)`.

## 15. Persistence

`RUNTIME_STATE_PATH` contains `handoffs.json` and `traces/<traceId>.json`. Writes use mode `0600`, a same-directory temporary file, and atomic rename. Handoff identity is SHA-256 of request ID plus public reason. Synchronous single-process mutation makes warm concurrency deterministic; the first resolution is canonical.

## 16. API design

All required routes and schemas are implemented unchanged: `/`, `/healthz`, `/readyz`, `/api/profiles`, `/api/corpus`, `/v1/decide`, trace GET, handoff GET, and resolution POST. Unknown resources return `404`; malformed request/resolution returns `400`.

## 17. UI design

The “decision ledger” is an operator workbench rather than chat. It exposes trusted context, date, request composer, decision state, score, claims, exact evidence, source metadata, trace counts, history, handoff receipt, preserved work record, and resolution. Every locked `data-testid` is present in its relevant state. Layout collapses without horizontal overflow at 390 px.

## 18. Optional model integration

A future `ModelProvider.generate()` may rewrite already-approved claim text under a short timeout and circuit breaker. It may never choose sources, eligibility, conflict outcome, reason code, citation, or route. 401/429/5xx/network/malformed output falls back to the deterministic body. This version intentionally reports `not_used`.

## 19. Security

User and source text are data, never instructions. Trusted requester axes are separate fields. Inputs and response sizes are bounded; IDs are path-safe; UI rendering uses `textContent`; traces omit raw questions/history/source text/secrets/personal data; source contents never appear in inventory responses.

## 20. Observability

Each trace stores request/trace IDs, versions, ordered stages, exact candidate/eligible/rejected counts, source/version identities, rejection aggregates, rank/offset/score metadata, conflict signals, provider state, route, and stage timings. It excludes raw text and hidden reasoning.

Successful claims include backward-compatible evidence usage metadata (`primary` or `supporting`) and a deterministic evidence-quality confidence score. The score is not a probability of truth: it combines explicit answer sufficiency, current eligible authority, exact citations, resolved region, and conflict penalties. Defer confidence describes confidence in the inability to safely answer from governed evidence.

## 21. Testing strategy

Unit tests cover parser limits, UTF-8 citations, token expansion, inclusive dates, injection, unsupported near-matches, conflict routing, contract validation, 20 named governed-retrieval regressions, and expired-agreement explanation. Integration tests cover API/eval runner and handoff restart/idempotency/resolution. Browser verification covers answer, evidence, trace, defer, open, resolve, history, responsive overflow, and console errors.

## 22. Candidate eval suite

Nineteen cases cover ten answers, eight deferrals, one conversation, two multi-source cases, two conflicts, two missing-evidence cases, two privacy/injection cases, six repeated clusters, a one-axis counterfactual, and the candidate-defined workflow-state risk.

## 23. Implementation plan

Completed in vertical slices: contract/types; passage/index; governance/conflicts; decisions/citations; durable traces/handoffs; endpoints; operator UI; evals/tests; documents/container hardening.

## 24. Risks and trade-offs

Lexical recall, passage-specific scope, incomplete metadata, heuristic conflict detection, template rigidity, and filesystem multi-process concurrency remain limitations. The deterministic design favors auditable safety and feasible 16-hour delivery over broad semantic coverage.

## 25. Future extensions

Add a local embedding adapter behind the retriever, reciprocal-rank hybrid fusion, reranking after governance, declarative governance/authority configuration, PostgreSQL transactional stores, queue delivery, tenant-scoped authorization, resolution feedback, and offline precision/recall dashboards.

## 26. Open questions

What is the real request distribution? Which outcomes are adjudicated? Who owns each source and conflict SLA? Can the existing assistant call the service? What authorization and retention rules apply to traces/handoffs? What loaded error cost and capacity plan would turn reduced touches into realized value?
