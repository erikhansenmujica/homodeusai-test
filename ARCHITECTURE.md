# Architecture

## System shape

The submission is one Node.js 24 process and one container. It loads the immutable normalized corpus, creates citable passages, builds lexical plus selected semantic retrieval, applies governance deterministically, renders a typed decision, and persists derived indexes, traces, and human work under `RUNTIME_STATE_PATH`.

```text
Trusted HTTP request
  -> contract validation
  -> conversational / human / protected-intent checks
  -> People Operations scope + live-state boundary
  -> passage extraction + BM25 / deterministic semantic or optional multilingual E5 + RRF
  -> source governance, trusted scope, and explicit supersession
  -> per-clause topic and answer-shape support
  -> deterministic conflict detection
  -> answer | defer + durable handoff | conversational
  -> durable redacted trace
  -> contract-valid JSON and operator UI
```

`src/corpus.ts` remains the integrity boundary for `source-documents.json`. `src/runtime.ts` owns the explicit initialization state and refuses traffic until corpus, retrieval, model/fallback, and durable stores are ready. `src/retrieval.ts` extracts and ranks citable units with Portuguese normalization and bounded synonym expansion. `src/learned-semantic.ts` runs pinned local E5 when enabled; `src/semantic.ts` is the evaluated deterministic default. `src/governance.ts` evaluates approval, employee audience, sensitivity, inclusive validity, four trusted scope axes, and supersession before a passage can support an answer.

`src/decide.ts` orchestrates non-bypassable stages. Conversation context, answer sufficiency/shape, versioned domain configuration, retrieval, governance, and conflict detection are separate modules. Up to three completed user turns may supply topic context; assistant text is never evidence or trusted requester context. Every material clause must independently match an eligible passage, the requested answer shape, and a 60% subject-term coverage floor. A direct answer is copied from exact eligible passages; every material body statement is also a claim.

`src/evidence.ts` converts JavaScript character positions to zero-based, half-open UTF-8 byte ranges and hashes the exact bytes. Repository interfaces isolate filesystem adapters for handoffs and traces. Handoff identity includes a canonical request fingerprint, conflicting reuse returns `409`, corrupt state fails readiness, and bounded trace retention preserves records used by open handoffs.

## Chosen trade-offs

- Deterministic retrieval by default: the 21-case A/B matrix found no safety or coverage gain from E5, so the fast adapter is the operational default. The image still contains a checksum-verified E5/index pair for opt-in evaluation without granting semantic scores authority over governance.
- No production database: a filesystem store is adequate for one process and warm concurrency of three. PostgreSQL would be the first production replacement for multi-instance locking, retention, and reporting.
- No generative model call: source eligibility, conflict handling, citations, routing, and extractive answers remain deterministic. The trace reports learned-embedding health as `ok` or `degraded`.
- Extractive rendering limits eloquence but prevents ungrounded connective prose. A later model may rewrite claim text only after evidence is locked and must pass a claim/evidence validator.
- Conflict detection is deliberately conservative and lexical. It covers the known numeric, polarity, and temporal contradictions but is not a general natural-language theorem prover.

## Trust, authorization, and isolation

The case evaluator supplies a synthetic single-tenant trusted requester context. The UI only sends legal entity, base, relationship, and role from `/api/profiles`; question text cannot edit those fields.

Production must derive tenant, subject, and operator roles from an authenticated gateway, not a browser dropdown. Every corpus row, trace, handoff, and idempotency key must carry a tenant ID. Authorization must separately control employee decisions, operator trace access, protected handoff access, and resolution actions. Handoff resolution requires an operator role plus queue membership; sensitive queues require step-up authorization. Storage keys and encryption boundaries must include the tenant. Audit events must record actor and action identifiers without copying questions, source text, or personal values.

## Failure modes that still matter

- Intent and per-clause subject detection remain heuristic and can miss novel People Operations phrasing.
- Learned similarity can retrieve attractive but unrelated passages; deterministic subject and answer-shape gates remain the safety boundary.
- Passage-level relationship meaning can be more specific than document-level metadata.
- Conflict rules can miss a contradiction expressed without shared terms.
- A corrupt or unavailable state mount prevents durable handoff guarantees and must fail readiness in production.
- Filesystem atomicity is local to one mounted filesystem; it is not a multi-node transaction protocol.
- The corpus has only one snapshot and no production feedback distribution, so local pass rate cannot estimate rollout safety.
- The filesystem repositories are intentionally single-instance. A pilot requiring multiple writers must move to PostgreSQL plus an outbox before horizontal scale.

## Timebox allocation

The 16-hour allocation was: 2 hours diagnosis and contract mapping; 5 hours corpus, retrieval, governance, conflicts, and citations; 2 hours durable lifecycle and API hardening; 3 hours operator UI and responsive states; 2 hours evals and regression tests; 2 hours documentation, screenshots, and container checks. Admission automation, write integrations, a model rewrite layer, and database migration were intentionally excluded.
