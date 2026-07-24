import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/decide.ts";
import { getTrace } from "../src/traces.ts";

const requester = {
  subjectId: "governance-boundary",
  legalEntityId: "NA_SERVICOS",
  baseId: "SUDESTE",
  relationship: "employee",
  role: "colaborador",
  domains: [],
};

function request(requestId: string, question: string) {
  return {
    requestId,
    question,
    asOf: "2026-07-22T10:30:00.000Z",
    requester,
    history: [],
  };
}

test("clearly non-policy questions are conversational even when words overlap the corpus", async () => {
  const questions = [
    "Qual e o nome da minha mae?",
    "Qual é o ponto mais alto do Brasil?",
    "Qual banco fica perto de mim?",
    "Quantos dias tem fevereiro?",
    "Quem é o presidente do Brasil?",
    "Como faço arroz?",
  ];
  for (const [index, question] of questions.entries()) {
    const decision = await decide(request(`outside-scope-${index}`, question));
    assert.equal(decision.kind, "conversational", question);
    if (decision.kind === "conversational") assert.match(decision.body, /limitado.*People Operations/iu, question);
    assert.equal(getTrace(decision.traceId)?.governance.candidateCount, 0, question);
  }
});

test("personal live People Operations facts defer instead of borrowing a general policy", async () => {
  for (const [index, question] of [
    "Qual é o nome do meu gestor?",
    "Qual é o nome do meu projeto?",
    "Qual é o meu endereço cadastrado?",
  ].entries()) {
    const decision = await decide(request(`personal-live-fact-${index}`, question));
    assert.equal(decision.kind, "defer", question);
    if (decision.kind === "defer") assert.equal(decision.handoff.reasonCode, "sensitive_topic", question);
  }
});

test("unsupported People Operations questions still create a governed missing-source handoff", async () => {
  for (const [index, question] of [
    "Existe auxílio para internet?",
    "Tem ajuda para certificação?",
  ].entries()) {
    const decision = await decide(request(`unsupported-people-ops-${index}`, question));
    assert.equal(decision.kind, "defer", question);
    if (decision.kind === "defer") assert.equal(decision.handoff.reasonCode, "missing_source", question);
  }
});

test("supported safe-channel and relationship-specific questions still answer", async () => {
  const bankData = await decide(request("bank-data-channel", "Posso mandar um dado bancário no chat?"));
  assert.equal(bankData.kind, "answer");
  if (bankData.kind === "answer") {
    assert.match(bankData.body, /fluxo protegido do Farol/iu);
    assert.equal(bankData.claims[0]?.evidence[0]?.sourceId, "na-faq-personal-data-v1");
  }

  const admission = await decide(request("employee-admission-documents", "Quais documentos um empregado precisa no ingresso?"));
  assert.equal(admission.kind, "answer");
  if (admission.kind === "answer") {
    assert.match(admission.body, /Documento de identidade válido.*comprovante de endereço/iu);
    assert.equal(admission.claims[0]?.evidence[0]?.sourceId, "na-admission-documents-v6");
  }
});

test("an unaccented copula is not treated as a compound-question conjunction", async () => {
  const decision = await decide(request("unaccented-copula", "Qual e o prazo para ajuste após o fechamento?"));
  assert.equal(decision.kind, "defer");
  if (decision.kind === "defer") assert.equal(decision.handoff.reasonCode, "conflicting_source");
});

test("every material clause of a compound request needs its own supporting passage", async () => {
  const supported = await decide(request(
    "supported-compound",
    "Como comunicar um incidente urgente e o chat pode diagnosticar uma condição?",
  ));
  assert.equal(supported.kind, "answer");
  if (supported.kind === "answer") {
    assert.equal(supported.claims.length, 2);
    assert.deepEqual(
      new Set(supported.claims.flatMap((claim) => claim.evidence.map((evidence) => evidence.sourceId))),
      new Set(["na-faq-health-safety-v1", "na-safety-process-v2"]),
    );
  }

  const partial = await decide(request(
    "partially-supported-compound",
    "Como comunicar um incidente urgente e qual é a capital da Argentina?",
  ));
  assert.equal(partial.kind, "defer");
  if (partial.kind === "defer") assert.equal(partial.handoff.reasonCode, "missing_source");
});

test("governance trace counts reconcile by unique source and version", async () => {
  for (const [requestId, question] of [
    ["trace-answer", "Quais registros preciso fazer no ponto durante o expediente?"],
    ["trace-defer", "Existe auxílio para internet?"],
  ] as const) {
    const decision = await decide(request(requestId, question));
    const trace = getTrace(decision.traceId);
    assert.ok(trace);
    assert.equal(
      trace.governance.candidateCount,
      trace.governance.eligibleCount + trace.governance.rejectedCount,
      question,
    );
    assert.equal(trace.governance.eligibleSources.length, trace.governance.eligibleCount, question);
    assert.equal(
      Object.values(trace.governance.rejectionReasons).reduce((total, count) => total + count, 0),
      trace.governance.rejectedCount,
      question,
    );
    assert.equal(
      new Set(trace.governance.eligibleSources.map((source) => `${source.sourceId}@${source.versionId}`)).size,
      trace.governance.eligibleSources.length,
      question,
    );
  }
});
