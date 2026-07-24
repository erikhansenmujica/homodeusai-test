# Architecture

## System shape

The submission is one dependency-light Node.js 24 process and one container. It loads the immutable normalized corpus, creates citable passages, builds an in-memory lexical index, applies governance deterministically, renders a typed decision, and persists traces and human work under `RUNTIME_STATE_PATH`.

```text
Trusted HTTP request
  -> contract validation
  -> conversational / human / protected-intent checks
  -> passage extraction + lexical retrieval
  -> source governance and explicit supersession
  -> deterministic conflict detection
  -> answer | defer + durable handoff | conversational
  -> durable redacted trace
  -> contract-valid JSON and operator UI
```

`src/corpus.ts` remains the integrity boundary for `source-documents.json`. `src/retrieval.ts` extracts FAQ rows, Markdown sections, clauses, and process blocks and ranks them using an in-memory BM25-style score with Portuguese normalization and bounded synonym expansion. `src/governance.ts` evaluates approval, employee audience, sensitivity, inclusive validity, four trusted scope axes, and supersession before a passage can support an answer.

`src/decide.ts` owns routing. It never lets retrieved text modify governance. A direct answer is template-rendered from one or two exact eligible passages; every material body statement is also a claim. Conflicts are detected from incompatible values, polarity, and timing signals across relevant eligible sources. Authority affects retrieval ordering but never silently resolves a contradiction.

`src/evidence.ts` converts JavaScript character positions to zero-based, half-open UTF-8 byte ranges and hashes the exact bytes. `src/queue.ts` persists idempotent handoffs with atomic replacement. `src/traces.ts` writes one redacted JSON record per trace using temporary-file-plus-rename.

## Chosen trade-offs

- No embeddings or vector service: 34 sources fit comfortably in memory, deterministic lexical behavior works offline, and the main risk is governance rather than semantic recall. The index interface is separable so a hybrid retriever can be added later.
- No production database: a filesystem store is adequate for one process and warm concurrency of three. PostgreSQL would be the first production replacement for multi-instance locking, retention, and reporting.
- No required model call: the optional proxy is never necessary for source eligibility, conflict handling, citations, or routing. When absent, every trace reports `not_used` and behavior is unchanged.
- Template rendering limits eloquence but prevents ungrounded connective prose. A later model may rewrite claim text only after evidence is locked and must pass a claim/evidence validator.
- Conflict detection is deliberately conservative and lexical. It covers the known numeric, polarity, and temporal contradictions but is not a general natural-language theorem prover.

## Trust, authorization, and isolation

The case evaluator supplies a synthetic single-tenant trusted requester context. The UI only sends legal entity, base, relationship, and role from `/api/profiles`; question text cannot edit those fields.

Production must derive tenant, subject, and operator roles from an authenticated gateway, not a browser dropdown. Every corpus row, trace, handoff, and idempotency key must carry a tenant ID. Authorization must separately control employee decisions, operator trace access, protected handoff access, and resolution actions. Handoff resolution requires an operator role plus queue membership; sensitive queues require step-up authorization. Storage keys and encryption boundaries must include the tenant. Audit events must record actor and action identifiers without copying questions, source text, or personal values.

## Failure modes that still matter

- Lexical retrieval can miss novel paraphrases or over-weight repeated synthetic language.
- Passage-level relationship meaning can be more specific than document-level metadata.
- Conflict rules can miss a contradiction expressed without shared terms.
- A corrupt or unavailable state mount prevents durable handoff guarantees and must fail readiness in production.
- Filesystem atomicity is local to one mounted filesystem; it is not a multi-node transaction protocol.
- The corpus has only one snapshot and no production feedback distribution, so local pass rate cannot estimate rollout safety.

## Timebox allocation

The 16-hour allocation was: 2 hours diagnosis and contract mapping; 5 hours corpus, retrieval, governance, conflicts, and citations; 2 hours durable lifecycle and API hardening; 3 hours operator UI and responsive states; 2 hours evals and regression tests; 2 hours documentation, screenshots, and container checks. Admission automation, write integrations, a model rewrite layer, and database migration were intentionally excluded.
