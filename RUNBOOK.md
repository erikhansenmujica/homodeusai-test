# Runbook

## Build and start

```bash
npm ci
npm run typecheck
npm test
RUNTIME_STATE_PATH=/tmp/nexo-state npm start
```

The service listens on `0.0.0.0:8080`. Check:

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:8080/api/profiles
curl -fsS http://127.0.0.1:8080/api/corpus
```

`healthz` proves process liveness. `readyz` loads and integrity-checks all corpus documents. Do not route decisions until readiness succeeds.

## Test and evaluate

```bash
npm run typecheck
npm test
npm run self-check
CANDIDATE_BASE_URL=http://127.0.0.1:8080 npm run evals
```

The eval runner requires only Node 24 built-ins. Individual failed cases remain in its JSON report; an incomplete execution returns nonzero.

## Restricted container check

Use the exact commands in `SUBMISSION.md`. Important controls are numeric user `65532:65532`, read-only root, `/tmp` scratch, the owned `/state` mount, no capabilities, 2 CPU, 4 GiB memory, and 256 processes. Recreate the container against the same state volume and retrieve an existing handoff before declaring persistence healthy.

## Index or corpus recovery

The lexical index is derived in memory from `CORPUS_PATH`; it is never authoritative state.

1. Check `/readyz`.
2. Verify `case-data/source-documents.json` exists and is readable.
3. Run `npm run self-check` to verify all 34 content hashes and expected corpus totals.
4. Restore the unchanged corpus from the submitted commit if integrity fails.
5. Restart the process. The index rebuilds automatically.

Never edit corpus content or generated hashes to bypass an integrity error.

## Provider outage

The current implementation does not require the optional provider. Leave `MODEL_BASE_URL`, `MODEL_API_KEY`, and `MODEL_NAME` unset; traces should show `provider.status: "not_used"`. If a future rewrite adapter is enabled, disable it during 401, 429, timeout, malformed response, or 5xx incidents and retain deterministic decisions. Provider failure must never bypass governance or alter citations.

## Handoff incident

Handoffs live in `${RUNTIME_STATE_PATH}/handoffs.json`; traces live in `${RUNTIME_STATE_PATH}/traces/`.

1. Stop new traffic if `/state` is unavailable or read-only.
2. Preserve the mounted state directory before repair.
3. Retrieve the ticket through `GET /v1/handoffs/:ticketId`.
4. Compare its idempotency key, request context, trace ID, queue, and timestamps.
5. Replay the same logical request only after verifying the first write outcome. Never automatically retry an uncertain handoff creation.
6. Resolve through the API; do not edit JSON manually.
7. Recreate the container against the same mount and verify the canonical record.

If competing resolutions occur, the first stored resolution is canonical; subsequent resolutions return it unchanged.

## Trace incident

Traces intentionally omit raw question/history, source text, secrets, and personal data. A trace must reconcile its ordered stages, eligible/rejected counts, source/version set, provider status, and final route. Treat any protected-content leak or count mismatch as a stop condition.
