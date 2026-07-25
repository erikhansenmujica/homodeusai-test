# Runbook

## Build and start

The evaluated default is pinned multilingual E5 retrieval. The container includes the verified model and prebuilt corpus index, so startup and requests do not need Internet access.

```bash
npm ci
npm run typecheck
npm test
npm run setup:model
npm run build:index
LEARNED_SEMANTIC_ENABLED=true RUNTIME_STATE_PATH=/tmp/nexo-state npm start
```

The service listens on `0.0.0.0:8080`. Liveness does not imply readiness:

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:8080/metrics
```

`/readyz` returns `503` while initializing or after a corpus/state failure. A `200` response includes `status`, `retrievalMode`, `corpusVersion`, document/passage counts, and initialization duration. Do not route `/v1/decide` until it succeeds.

## Learned-model lifecycle

The learned adapter is pinned to `Xenova/multilingual-e5-base` revision `1ec9243030a27d1a115d5c340572074c125b58b2`. It is never downloaded at startup or request time.

```bash
npm run setup:model
npm run verify:model
npm run build:index
LEARNED_SEMANTIC_ENABLED=true RUNTIME_STATE_PATH=/tmp/nexo-learned npm start
```

`setup:model` gives each pinned asset up to five bounded download attempts for transient transport or server failures. Retries use exponential delays of 2, 4, 8, and 16 seconds, honor a longer server `Retry-After` within a 30-second cap, and then verify every tokenizer, configuration, SentencePiece, and int8 ONNX checksum. Non-retryable client responses fail immediately. `build:index` records the model revision and every passage hash. A stale or incompatible index is rebuilt. If the model is missing or invalid, readiness completes as `ready_degraded`; traces expose provider state only as `ok` or `degraded`.

The multi-stage Docker build downloads and verifies the pinned assets without relying on ignored local files. The runtime defaults to learned mode because the frozen suite passed 21/21 there versus 9/21 exact outcomes in degraded mode. When model initialization fails, `ready_degraded` remains available as a safe, abstention-first fallback; it is not advertised as multilingual semantic equivalence.

CI has one prerequisite model job that downloads and checksum-verifies the pinned directory, then publishes a revision-keyed GitHub Actions cache. Quality, browser, and evaluation jobs wait for and restore that cache before running `setup:model` as an integrity check, which prevents parallel cold downloads and ensures learned-mode assertions cannot silently execute against the degraded fallback. The clean Docker build also waits for the model job but downloads inside its build context to prove that ignored local assets are unnecessary. The evaluation job still starts a separate model-disabled runtime to verify safe degraded behavior intentionally.

## Test and evaluate

```bash
npm run typecheck
npm test
npm run self-check
npm run test:e2e
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
npm run evals:matrix
```

The candidate suite has 21 authored cases. The matrix runs both degraded and learned configurations, records exact outcome coverage, unsupported-answer safety, startup, and first-decision latency. It fails if either mode produces an unsafe autonomous answer or misses the operational ceilings; learned mode must also improve coverage to remain the default.

## Candidate artifact

The export is intentionally commit-bound:

```bash
npm run verify:submission
npm run export:candidate
cd dist && shasum -a 256 -c nexo-atlantico-knowledge-case.tgz.sha256
```

Export refuses a dirty tree. It archives only tracked regular files from `HEAD`, enforces the submission limits, and writes the archive/checksum served by the download routes.

## Restricted container check

Use the exact limits in `SUBMISSION.md`: numeric user `65532:65532`, read-only root, writable `/tmp` and `/state`, no capabilities, 2 CPU, 4 GiB memory, and 256 processes. Readiness must succeed within 180 seconds. The first decision after readiness must be under the 10-second container ceiling.

Recreate the container against the same state mount and retrieve an existing handoff before declaring persistence healthy.

The final validation on 2026-07-25 built without ignored local assets, reached `ready_learned` in 13.42 seconds, returned the first end-to-end decision in 1.351 seconds, and restored an open handoff after a container recreation against the same named volume.

## Corpus or index incident

1. Stop decision traffic when `/readyz` fails.
2. Verify `case-data/source-documents.json` is readable.
3. Run `npm run self-check` to verify all 34 sources, 22 deliveries, hashes, and corpus totals.
4. Restore the unchanged corpus from the submitted commit if integrity fails.
5. Remove only a derived semantic-index file after preserving incident evidence; never edit corpus hashes.
6. Restart and wait for readiness.

## State incident

Handoffs live in `${RUNTIME_STATE_PATH}/handoffs.json`; traces live in `${RUNTIME_STATE_PATH}/traces/`.

1. Stop new traffic if the state path is unavailable, read-only, or corrupt. Readiness treats corruption as fatal.
2. Preserve the mounted state directory before repair.
3. Retrieve the ticket with `GET /v1/handoffs/:ticketId` and its trace with `GET /v1/traces/:traceId`.
4. Compare request fingerprint, idempotency key, trusted context, trace, queue, and timestamps.
5. Never replay an uncertain write until the first outcome is known. Reusing an idempotency identity with different content returns typed `409`.
6. Resolve through the API; do not edit JSON manually.

The first stored resolution is canonical. Trace retention keeps at most 500 ordinary records while preserving traces referenced by open handoffs.

## Observability and privacy

Structured logs contain correlation ID, normalized route, status, duration, decision kind, public reason code, and retrieval mode. Metrics contain only counters and latency buckets. Neither surface may contain questions, history, source text, personal values, or path identifiers.

Treat any protected-content leak, unreconciled trace, corrupt durable state, duplicate/lost handoff, or unsupported answer as a stop condition.
