# Runbook

## Build and start

The evaluated default is deterministic retrieval. It starts quickly, requires no model files, and preserves every governance and evidence gate.

```bash
npm ci
npm run typecheck
npm test
LEARNED_SEMANTIC_ENABLED=false RUNTIME_STATE_PATH=/tmp/nexo-state npm start
```

The service listens on `0.0.0.0:8080`. Liveness does not imply readiness:

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:8080/metrics
```

`/readyz` returns `503` while initializing or after a corpus/state failure. A `200` response includes `status`, `retrievalMode`, `corpusVersion`, document/passage counts, and initialization duration. Do not route `/v1/decide` until it succeeds.

## Learned-model lifecycle

The optional learned adapter is pinned to `Xenova/multilingual-e5-small` revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`. It is never downloaded at startup or request time.

```bash
npm run setup:model
npm run verify:model
npm run build:index
LEARNED_SEMANTIC_ENABLED=true RUNTIME_STATE_PATH=/tmp/nexo-learned npm start
```

`setup:model` verifies every tokenizer, configuration, SentencePiece, and int8 ONNX checksum. `build:index` records the model revision and every passage hash. A stale or incompatible index is rebuilt. If the model is missing or invalid, readiness completes as `ready_degraded`; traces expose provider state only as `ok` or `degraded`.

The multi-stage Docker build downloads and verifies the pinned assets without relying on ignored local files. The runtime defaults to deterministic mode because the frozen 21-case A/B suite showed no safety or coverage improvement from E5. Operators can opt in with `-e LEARNED_SEMANTIC_ENABLED=true`.

## Test and evaluate

```bash
npm run typecheck
npm test
npm run self-check
npm run test:e2e
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
npm run evals:matrix
```

The candidate suite has 21 authored cases. The matrix runs both deterministic and learned configurations, records startup/first-decision latency, and fails if either mode produces an unsafe result or misses the operational ceilings.

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
