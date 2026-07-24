# Technical Design

## 1. Executive summary

The implemented version is an offline-capable governed decision service. It uses citable passage extraction, pinned multilingual E5 retrieval by default, source eligibility rules, explicit conflict checks, extractive source-backed answers, exact UTF-8 citations, and durable repository-backed handoffs/traces. A conservative lexical/hashed adapter provides safe degraded operation, and a generative LLM is not a critical dependency.

## 2. Goals

- Return `answer`, `defer`, or `conversational` under the locked contract.
- Answer only from exact eligible evidence for the trusted requester and `asOf`.
- Preserve an actionable case when autonomous answering is unsafe.
- Operate in one read-only-root container without public Internet.
- Expose a finished responsive operator desk and runnable candidate eval suite.

## 3. Non-goals

A vector database, microservices, write integrations, admission decisions, live personal state, clinical or financial calculation, production multi-tenancy, and autonomous generative-model judgment are excluded.

## 4. Current repository assessment

The starter already supplied strict public types, request/decision validation, corpus hash verification, UTF-8 evidence helpers, API routes, an idempotent handoff example, Docker constraints, and an eval runner using Node built-ins. Placeholders were the defer-all decision policy, memory-only traces, starter terminal, and two sample evals. The implementation preserves the trustworthy primitives and replaces those placeholders.

## 5. Functional requirements

The service validates trusted context, classifies non-policy conversation, retrieves passages, filters governance, detects supersession/conflicts, renders claims and citations, persists traces, creates/reuses/resolves handoffs, and serves profiles/corpus metadata. The UI supports request, history, evidence-to-source navigation, trace inspection, and full human completion.

## 6. Non-functional requirements

Startup is under 180 seconds; the first local decision after readiness targets under 1 second and the restricted-container ceiling is 10 seconds; responses stay below 256 KiB; state survives container recreation; the process runs as `65532:65532`; and no request-time path depends on Internet. The final local matrix measured degraded readiness/first decision at 1.03 s/125 ms and learned at 4.59 s/181 ms. The restricted Node 24 container reached learned readiness in 20.58 s and returned its first decision in 0.93 s.

## 7. Proposed architecture

```text
HTTP -> validation -> intent boundary -> BM25 + local E5 retrieval -> RRF
     -> governance -> topic/claim sufficiency -> supersession -> conflicts
     -> answer | defer + handoff | conversational
     -> trace persistence -> JSON/UI
```

Modules are `contract`, `corpus`, `runtime`, `domain-config`, `conversation`, `retrieval`, `answer-support`, `governance`, `conflicts`, `decide`, `evidence`, `queue`, `traces`, `metrics`, `server`, and `ui`.

## 8. Request lifecycle

Malformed input returns typed `400`. Conversational and explicit-human routes short-circuit safely. Other requests retrieve at most 48 passages, govern the best 28 passages without premature source deduplication, rerank eligible passages, detect conflicts, and select at most two answer passages. A defer persists its work record before response completion. Every valid decision has a retrievable redacted trace.

## 9. Domain model

Existing `Decision`, `DecideRequest`, `SourceDocument`, evidence, handoff, and trace types are reused. `Passage`, `RetrievalCandidate`, `EligibilityResult`, `EligibilityRejection`, `Conflict`, and `RetrievalRun` extend `src/types.ts`. Discriminated unions represent decisions and eligibility.

## 10. Retrieval design

FAQ rows, Markdown paragraphs under headings, collective clauses, and process blocks are citation units with stable character and UTF-8 byte ranges. Synthetic `CENÁRIO_OPERACIONAL` records are excluded because they are generated test noise rather than approved guidance. Lexical text is Unicode-normalized, lowercased with the locale-independent `und` locale, tokenized by Unicode letter/number classes, and augmented with corpus-derived character trigrams. There are no Portuguese/English stopword, synonym, or query-phrase tables. Titles, headings, and bodies receive distinct BM25-style weights. After governance, semantic answer shapes (percentage, currency, duration, entitlement, list, event, boolean, channel, individual-state, or general rule), authority, source type, answer alignment, and scope specificity rerank candidates.

Validated semantic prototypes in `config/semantic-patterns.json` describe routing intents, answer shapes, question composition, and governed retrieval concepts. They are embedded rather than token-matched, so the same concepts operate across supported model languages. Explicit region discovery is derived from corpus titles and scope metadata; it never replaces the base supplied by the trusted requester boundary. A source for a different named region therefore remains ineligible rather than answering under an invented profile.

Hybrid retrieval uses local multilingual E5 embeddings through Transformers.js 3.7.2 (`Xenova/multilingual-e5-base`, revision `1ec9243030a27d1a115d5c340572074c125b58b2`, `model_int8.onnx`). The multi-stage image build downloads every pinned asset, verifies every checksum, and prebuilds a corpus-specific index. Startup validates model identity and passage hashes before reuse. Remote loading is disabled. If learned initialization fails, the runtime explicitly becomes `ready_degraded` and uses the deterministic hashed-subword adapter. Degraded answers require high lexical coverage and reject embedded structured payloads; ambiguous cases abstain. Neither semantic adapter can override governance, authority, conflicts, or exact citations.

## 11. Governance design

`evaluateEligibility(source, request, activeSuperseders)` checks, in order: approval, employee audience, high sensitivity, future validity, inclusive end validity, legal entity, base, relationship, role, and active supersession. Rejections are traceable codes. Rejected/internal/high/pending sources may affect routing but never claims.

## 12. Conflict and precedence resolution

An effective approved source’s explicit `supersedes` list removes the older record. Authority tier ranks but does not erase disagreement. Relevant eligible sources are compared for incompatible numeric/ordinal values, opposed polarity, and opposed timing. Scope differences are removed by eligibility before comparison. A detected material conflict yields `conflicting_source`.

## 13. Decision logic

`answer` requires sufficient hybrid strength, lexical corroboration or learned semantic support, answer-shape alignment, eligible evidence, no conflict, and valid citations. A numeric duration cannot satisfy an entitlement question. Policy answer text is copied only from selected source passages; fixed UI text is limited to conversational and handoff states. A second source is included only for a semantically classified compound question and must cover a distinct material clause. `defer` handles human request, missing/low evidence, scope mismatch, pending/stale source, protected source, conflict, sensitive individual state, injection, and degraded ambiguity.

## 14. Evidence and citations

The selected answer substring is located inside exact corpus content. The prefix byte length becomes `startByte`; quote byte length determines `endByte`; SHA-256 hashes the quote bytes. Tests round-trip multibyte Portuguese through `Buffer.from(content, "utf8").subarray(start, end)`.

## 15. Persistence

`RUNTIME_STATE_PATH` contains `handoffs.json`, `traces/<traceId>.json`, and optional derived indexes. Filesystem adapters implement explicit handoff/trace repository interfaces. Writes use mode `0600`, a same-directory temporary file, and atomic rename. Handoff identity is SHA-256 of request ID plus public reason; a separate canonical fingerprint prevents reuse with different request content. Synchronous single-process mutation makes warm concurrency deterministic; the first resolution is canonical. Trace retention is bounded while open-handoff traces are preserved. Corrupt state fails readiness.

## 16. API design

All required routes and schemas are implemented unchanged: `/`, `/healthz`, `/readyz`, `/api/profiles`, `/api/corpus`, `/v1/decide`, trace GET, handoff GET, and resolution POST. `/readyz` adds runtime diagnostics and returns `503` until warm-up succeeds. `/metrics` adds redacted counters and latency buckets. Unknown resources return `404`; malformed input returns `400`; idempotency-content conflict returns `409`.

## 17. UI design

The “decision ledger” is an operator workbench rather than chat. It exposes trusted context, date, request composer, decision state, qualitative evidence band plus contract score, claims, exact evidence, source metadata, trace counts, history, handoff receipt, preserved work record, and resolution. The score is explicitly evidence sufficiency, not truth probability. Result rendering preserves the viewport. Source routes use internal history and `replaceState`; the small-screen drawer is a focus-trapped modal with inert background, Escape/backdrop close, and focus return. Browser storage keeps bounded decision summaries and identifiers, then refetches evidence, traces, and handoffs.

## 18. Optional generative-model integration

A future `ModelProvider.generate()` may rewrite already-approved claim text under a short timeout and circuit breaker. It may never choose sources, eligibility, conflict outcome, reason code, citation, or route. 401/429/5xx/network/malformed output falls back to the deterministic body. This version does not use a generative model; the trace provider state currently describes the learned embedding provider.

## 19. Security

User and source text are data, never instructions. Trusted requester axes are separate fields. Inputs and response sizes are bounded; IDs are path-safe; UI rendering uses `textContent`; traces omit raw questions/history/source text/secrets/personal data; source contents never appear in inventory responses. Assets use an explicit path/MIME allowlist. CSP, frame denial, no-referrer, permissions policy, `nosniff`, correlation IDs, and `no-store` protect sensitive responses.

## 20. Observability

Each trace stores request/trace IDs, versions, ordered stages, exact candidate/eligible/rejected counts, source/version identities, rejection aggregates, rank/offset/score metadata, conflict signals, provider state (`ok` or `degraded`), route, and stage timings. It excludes raw text and hidden reasoning. Structured logs and metrics use normalized routes and public codes only.

Successful claims include backward-compatible evidence usage metadata (`primary` or `supporting`) and a deterministic evidence-quality confidence score. The score is not a probability of truth: it combines explicit answer sufficiency, current eligible authority, exact citations, resolved region, and conflict penalties. Defer confidence describes confidence in the inability to safely answer from governed evidence.

Versioned semantic concepts identify private record attributes, individual financial outcomes, and live request status without query-language keyword matching. Static policies are not sufficient evidence for approval, pending, processed, balance, or provisioning state; the service defers instead of rendering a normative policy as a live answer.

## 21. Testing strategy

Unit tests cover parser limits, UTF-8 citations, token expansion, inclusive dates, injection, unsupported near-matches, conflict routing, contract validation, named governed-retrieval regressions, follow-up ambiguity/injection, state corruption, fallback, security headers, readiness, and idempotency conflicts. Integration tests cover API/eval runner and handoff restart/idempotency/resolution. Real Playwright tests cover answer, follow-up, evidence/highlight, refresh/close routing, trace, defer/open/resolve, slow/error/retry, no-scroll rendering, 390 px overflow, modal focus, restricted-content privacy, and axe accessibility.

## 22. Candidate eval suite

Twenty-one cases cover twelve answers, eight deferrals, one conversation, two multi-source cases, two conflicts, two missing-evidence cases, privacy/injection, six repeated clusters, a one-axis counterfactual, contextual follow-ups, and the candidate-defined workflow-state risk.

## 23. Implementation plan

Completed in vertical slices: contract/types; passage/index; governance/conflicts; decisions/citations; durable traces/handoffs; endpoints; operator UI; evals/tests; documents/container hardening.

## 24. Risks and trade-offs

Passage-specific scope, incomplete metadata, semantic-pattern calibration, source-language conflict parsing, embedding calibration on synthetic text, and filesystem multi-process concurrency remain limitations. The design favors auditable abstention over unconstrained semantic answering.

## 25. Future extensions

Add declarative topic/claim schemas, a calibrated cross-encoder reranker, PostgreSQL transactional stores, queue delivery, tenant-scoped authorization, resolution feedback, and offline precision/recall dashboards.

## 26. Open questions

What is the real request distribution? Which outcomes are adjudicated? Who owns each source and conflict SLA? Can the existing assistant call the service? What authorization and retention rules apply to traces/handoffs? What loaded error cost and capacity plan would turn reduced touches into realized value?
