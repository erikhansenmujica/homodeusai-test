const baseUrl = String(process.argv[2] ?? "http://127.0.0.1:8080").replace(/\/$/u, "");
const maximumMs = Number(process.argv[3] ?? 10_000);
const started = performance.now();
const response = await fetch(`${baseUrl}/v1/decide`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    requestId: `first-ready-${Date.now()}`,
    question: "Com quanta antecedência devo solicitar férias?",
    asOf: "2026-07-24T12:00:00.000Z",
    requester: {
      subjectId: "container-smoke",
      legalEntityId: "NA_SERVICOS",
      baseId: "SUDESTE",
      relationship: "employee",
      role: "colaborador",
      domains: [],
    },
    history: [],
  }),
});
const durationMs = performance.now() - started;
if (!response.ok) throw new Error(`first decision failed with HTTP ${response.status}`);
const decision = await response.json() as { kind?: string };
if (!["answer", "defer", "conversational"].includes(String(decision.kind))) {
  throw new Error("first response was not a typed decision");
}
if (durationMs > maximumMs) {
  throw new Error(`first decision took ${durationMs.toFixed(3)} ms; ceiling is ${maximumMs} ms`);
}
console.log(JSON.stringify({ status: "ok", kind: decision.kind, durationMs: Number(durationMs.toFixed(3)) }));
