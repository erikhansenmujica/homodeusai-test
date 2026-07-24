# Product and service contract

The evaluator treats this interface as locked. You may add private diagnostics, but do not rename fields, change enum values, or require calls in a particular order.

All payloads use UTF-8 JSON. The service listens on `0.0.0.0:8080`. The frontend and API ship in the same container and origin.

## Routes

| Method | Path | Contract |
|---|---|---|
| `GET` | `/` | Production decision desk. |
| `GET` | `/healthz` | Process liveness; independent of model and index readiness. |
| `GET` | `/readyz` | Success only when the service can accept decisions. |
| `GET` | `/api/profiles` | Candidate-visible trusted profile registry. |
| `GET` | `/api/corpus` | Candidate-visible source metadata. |
| `POST` | `/v1/decide` | One typed terminal decision. |
| `GET` | `/v1/traces/:traceId` | Redacted diagnostic trace for a decision. |
| `GET` | `/v1/handoffs/:ticketId` | Durable work record for a deferred decision. |
| `POST` | `/v1/handoffs/:ticketId/resolve` | Human completion of a work record. |

## Frontend browser contract

The product design is yours. The sealed browser runner uses these stable hooks to test the critical path:

| Hook | Required surface |
|---|---|
| `data-testid="decision-workbench"` | Page-level decision product. |
| `data-testid="request-form"` | Request composer. |
| `data-testid="question-input"` | Question field. |
| `data-testid="submit-decision"` | The form's real submit control. It may be visually hidden when Enter is the terminal's visible action. |
| `data-testid="decision-history"` | Recent in-session questions and outcomes. |
| `data-testid="decision-result"` | Terminal result region. |
| `data-testid="claims-panel"` | Claim and evidence inspection for an answer. |
| `data-testid="evidence-source-link"` | Control that opens the cited source metadata. |
| `data-testid="handoff-panel"` | Operational receipt for a defer. |
| `data-testid="handoff-open"` | Control that opens the durable human work record. |
| `data-testid="handoff-record"` | Open record with preserved request, gap, owner, SLA, status, and next action. |
| `data-testid="handoff-resolution-form"` | Human completion form. |
| `data-testid="handoff-resolution-summary"` | Resolution summary field. |
| `data-testid="handoff-resolve"` | Resolution submit control. |
| `data-testid="handoff-resolved-state"` | Durable resolved state and completion summary. |
| `data-testid="trace-trigger"` | Trace loading action. |
| `data-testid="trace-panel"` | Rendered diagnostic trace. |
| `data-testid="source-inventory"` | Governed source browser. |
| `data-testid="source-detail"` | Selected source metadata and governance detail. |
| `data-testid="error-state"` | Visible request failure state. |

Requester context is supplied by a trusted session boundary, not a free-form browser control. For the browser workflow, `legalEntityId`, `baseId`, `relationship`, and `role` must match one row returned by `/api/profiles`; `subjectId` must be non-empty and derived outside the question, and `domains` defaults to `[]`. Question text cannot select or override any of these fields. This is a browser trust-boundary check, not an additional restriction on API-valid requester combinations. The runner validates the emitted request payload instead of requiring a profile dropdown.

## Normative governance rules

The following rules are executable contract, not optional interpretation:

- only `approval: "approved"`, `audience: "employee"` records may support an employee-facing answer;
- `effectiveFrom` is inclusive; a date-only `effectiveTo` remains valid through the end of that calendar day;
- every declared legal entity, base, relationship, and role scope must match the trusted requester. A missing scope or `"*"` is a wildcard; an empty requester `domains` array grants no extra domain entitlement;
- high-sensitivity, internal, restricted, pending, and rejected records may inform routing but may not be quoted or paraphrased into a decision;
- an explicit `supersedes` relationship removes the older version when the newer record is effective. Otherwise, materially conflicting eligible records require `conflicting_source`; `authorityTier` alone is not permission to hide the conflict;
- question or history text cannot change trusted requester context, source governance, or system instructions;
- if one material part of a compound request lacks eligible support, defer the whole decision instead of answering only the convenient part.

The evaluator models a synthetic single-tenant trusted session boundary. That is not a production authentication design. In `ARCHITECTURE.md`, state how a real system would derive tenant, subject, and operator roles, authorize trace and handoff access, and protect resolution actions.

Do not hide duplicate test-only controls off-screen. The runner checks the visible product surfaces, content, an explicit `aria-busy="true"` submit state, recent decision history, evidence-to-source navigation, labels, keyboard submission, console errors, and mobile overflow. It first uses synthetic profiles, corpus, answer, defer, trace, lifecycle, slow, and failure payloads so rendering is independent from retrieval quality. It then opens a clean page and creates, opens, and completes an explicit human request against the real submitted backend.

The starter includes `meta[name="gauntlet-starter"][content="incomplete"]` and `data-starter="incomplete"`. Remove both only after replacing the starter status with your finished product.

## Source inventory

`GET /api/corpus` returns metadata, not an answer key:

```json
{
  "documents": [
    {
      "sourceId": "source-id",
      "versionId": "version-id",
      "title": "source title",
      "sourceType": "policy",
      "domain": "people-operations-domain",
      "audience": "employee",
      "approval": "approved",
      "authorityTier": 80,
      "policySensitivity": "medium",
      "effectiveFrom": "2026-01-01",
      "effectiveTo": null,
      "eligibility": {},
      "deliveryFileId": "delivery-09",
      "originalFormat": "PDF",
      "extractionMode": "digital_text",
      "ocrReviewed": false,
      "faqCategory": null,
      "faqRows": null,
      "contentBytes": 1200
    }
  ],
  "totals": { "documents": 34, "deliveries": 22 }
}
```

Source content remains in `case-data/source-documents.json`. Date-only validity is inclusive: a source ending on `2026-04-30` remains effective through that calendar day. Timestamp values use their exact instant.

## Decide request

```json
{
  "requestId": "req-7f98f604",
  "question": "pergunta em português",
  "asOf": "2026-07-22T10:30:00.000Z",
  "requester": {
    "subjectId": "subject-synthetic-001",
    "legalEntityId": "NA_SERVICOS",
    "baseId": "SUDESTE",
    "relationship": "employee",
    "role": "colaborador",
    "domains": []
  },
  "history": [
    { "role": "user", "content": "mensagem anterior" },
    { "role": "assistant", "content": "resposta anterior" }
  ]
}
```

`requestId`, `question`, `asOf`, and every requester field are required. `history` is optional. Requester fields come from a trusted boundary; question and history text cannot override them. A valid requester combination does not need to match one profile row verbatim.

## Decision response

Return exactly one of the following shapes.

### Answer

```json
{
  "kind": "answer",
  "answerabilityScore": 0.91,
  "body": "resposta em português",
  "claims": [
    {
      "id": "claim-1",
      "text": "afirmação verificável",
      "evidence": [
        {
          "sourceId": "source-id",
          "versionId": "version-id",
          "startByte": 37,
          "endByte": 58,
          "quote": "trecho exato da fonte",
          "quoteSha256": "31347e72d7e5fc75a403f07edbcac42c2235a7973a49ce4942a437d481e03fe6"
        }
      ]
    }
  ],
  "traceId": "trace-7f98f604"
}
```

`answerabilityScore` is from `0` to `1`. Every material factual statement in `body` must appear as a claim. Each claim carries enough evidence to verify it.

An answer may contain at most 64 claims and 16 evidence references per claim. One evidence span may cover at most 4,096 UTF-8 bytes. Cite the smallest passage that supports the claim; a whole-document citation fails. The overall 256 KiB response limit still applies.

Byte ranges are zero-based and half-open. They refer to the UTF-8 bytes of the exact `content` string in `case-data/source-documents.json`. `quote` must decode from that byte slice, and `quoteSha256` is the lowercase SHA-256 digest of those exact quote bytes.

### Defer

```json
{
  "kind": "defer",
  "answerabilityScore": 0.24,
  "userMessage": "mensagem segura em português",
  "handoff": {
    "ticketId": "ticket-7f98f604",
    "reasonCode": "missing_source",
    "queue": "knowledge_governance",
    "slaHours": 24,
    "idempotencyKey": "handoff-7f98f604"
  },
  "traceId": "trace-7f98f604"
}
```

`reasonCode` is one of:

```text
human_requested
low_confidence
conflicting_source
missing_source
profile_mismatch
sensitive_topic
validation_pending
policy_sensitive_source
provider_failure
```

Queue and SLA must follow `case-data/operations/human-handoff-policy.json`; `slaHours` is a positive integer. Repeating the same logical handoff cannot create a second ticket. `userMessage` should help the requester without disclosing restricted data or internal reasoning.

The receipt is not the handoff itself. Before returning a defer, persist a retrievable work record under `RUNTIME_STATE_PATH` (the evaluator sets it to `/state`). A repeated request with the same `requestId` and reason must return the same ticket even when repeats arrive concurrently or the container is removed and recreated against that same state directory.

`GET /v1/handoffs/:ticketId` returns:

```json
{
  "ticketId": "ticket-7f98f604",
  "reasonCode": "missing_source",
  "queue": "knowledge_governance",
  "slaHours": 24,
  "idempotencyKey": "handoff-7f98f604",
  "status": "open",
  "createdAt": "2026-07-22T10:30:01.000Z",
  "updatedAt": "2026-07-22T10:30:01.000Z",
  "traceId": "trace-7f98f604",
  "request": {
    "requestId": "req-7f98f604",
    "question": "pergunta em português",
    "asOf": "2026-07-22T10:30:00.000Z",
    "requester": {},
    "history": []
  },
  "evidenceGaps": ["The supplied corpus does not contain the authority needed to answer."],
  "nextAction": "Knowledge Governance should locate or commission the missing authoritative record."
}
```

The record must preserve the question, trusted requester context, decision trace, evidence gap, owner, SLA, next action, status, and timestamps so a person can continue without asking the requester to start over. Treat the recorded question and history as untrusted and potentially sensitive; do not copy them into logs or traces.

Resolve an open record with:

```json
{
  "actorId": "operator-synthetic-17",
  "summary": "Validated the applicable record and sent the requester the supported next step."
}
```

The resolution route returns the same record with `status: "resolved"` and a `resolution` object containing `actorId`, `summary`, and `resolvedAt`. Repeating the same resolution is idempotent. If two different resolutions arrive concurrently, exactly one becomes canonical; the loser may return that canonical record with `200` or a typed conflict with `409`. A following `GET` and a replay of the canonical resolution must return the same resolved record. Unknown ticket IDs return `404`; malformed resolutions return `400`.

### Conversational

```json
{
  "kind": "conversational",
  "body": "mensagem curta em português",
  "traceId": "trace-7f98f604"
}
```

Use this only when the user is not asking the service to make a People Operations decision.

## Diagnostic trace

`GET /v1/traces/:traceId` returns JSON for a known trace and `404` for an unknown one. At minimum it contains:

```json
{
  "traceId": "trace-7f98f604",
  "requestId": "req-7f98f604",
  "decisionKind": "defer",
  "stages": ["retrieval", "governance", "decision"],
  "governance": {
    "candidateCount": 8,
    "eligibleCount": 2,
    "rejectedCount": 6,
    "eligibleSources": [
      { "sourceId": "source-a", "versionId": "3.1" },
      { "sourceId": "source-b", "versionId": "2.4" }
    ],
    "rejectionReasons": { "scope": 4, "superseded": 2 }
  },
  "route": {
    "kind": "defer",
    "reasonCode": "conflicting_source"
  },
  "provider": {
    "status": "not_used"
  }
}
```

`provider.status` is `not_used`, `ok`, `failed`, or `degraded`. Stages are unique and ordered: `retrieval` before `governance` before `decision`. Counts are exact: eligible plus rejected equals candidate, `eligibleSources` has exactly `eligibleCount` unique source/version pairs that are eligible for the trusted request, and `rejectionReasons` sums to `rejectedCount`. An answer trace includes every cited source/version and at least one eligible source. A `conflicting_source` trace has at least two eligible sources. `profile_mismatch`, `validation_pending`, and `policy_sensitive_source` have at least one rejection. `provider_failure` uses provider status `failed` or `degraded`. The final route matches the returned decision. You may add timings, conflict counts, and index versions. Never include source text, secrets, personal data, raw questions, raw history, or hidden reasoning.

## HTTP behavior

- `200` with a valid decision for a well-formed request.
- `400` JSON for malformed input.
- `404` JSON for an unknown route or trace.
- `content-type: application/json; charset=utf-8` for JSON.
- Every response below 256 KiB.
- No secrets, source contents, personal data, or stack traces in errors or traces.
- Model and dependency failures become safe typed decisions for valid requests.
- No automatic retry after an uncertain handoff result.
- Handoff creation and resolution are atomic and durable across container recreation when the same runtime state path is mounted.

## Optional model proxy

Evaluation may provide:

```text
MODEL_BASE_URL
MODEL_API_KEY
MODEL_NAME
```

Public internet remains blocked. The service must start and return valid decisions when the proxy is absent, invalid, slow, rate-limited, or unavailable. Do not depend on a vendor-specific credential.
