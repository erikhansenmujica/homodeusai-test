import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/decide.ts";
import { getTrace } from "../src/traces.ts";

const profiles = {
  sudeste: { legalEntityId: "NA_SERVICOS", baseId: "SUDESTE", relationship: "employee", role: "colaborador" },
  centro: { legalEntityId: "NA_SERVICOS", baseId: "CENTRO_OESTE", relationship: "employee", role: "colaborador" },
  sul: { legalEntityId: "NA_SUL", baseId: "SUL", relationship: "employee", role: "colaborador" },
};

async function answer(question: string, profile = profiles.sudeste) {
  const result = await decide({ requestId: `improvement-${question}`, question, asOf: "2026-07-22T10:30:00.000Z",
    requester: { subjectId: "test", domains: [], ...profile }, history: [] });
  assert.equal(result.kind, "answer", question);
  if (result.kind !== "answer") throw new Error("expected answer");
  return result;
}

test("primary non-FAQ clauses answer controlled paraphrases", async () => {
  for (const [question, expected, source] of [
    ["Quais marcações um empregado sujeito a controle de jornada deve registrar durante o dia?", /entrada.*fim do intervalo.*saída/iu, "na-timekeeping-policy-v4"],
    ["Que tipo de instrumento é necessário para formalizar um estágio?", /instrumento educacional/iu, "na-admission-documents-v6"],
    ["Em quais situações um processo de encerramento precisa obrigatoriamente de revisão humana?", /estabilidade.*afastamento.*conflito documental.*dado pessoal/iu, "na-termination-policy-v3"],
    ["Quais registros preciso fazer no ponto durante o expediente?", /entrada.*saída/iu, "na-timekeeping-policy-v4"],
    ["Uma conversa com meu gestor já inicia meu desligamento?", /decisão formal registrada/iu, "na-termination-policy-v3"],
  ] as const) {
    const result = await answer(question);
    assert.match(result.body, expected, question);
    assert.equal(result.claims[0]?.evidence[0]?.sourceId, source, question);
    assert.equal(result.claims[0]?.confidence?.level, "high", question);
  }
});

test("controlled overtime and meal paraphrases retain regional values", async () => {
  for (const [profile, question, expected] of [
    [profiles.sudeste, "Quanto recebo pelas duas primeiras horas extras autorizadas?", /62%/u],
    [profiles.centro, "Qual é o percentual das duas primeiras horas extras?", /55%/u],
    [profiles.sul, "Qual compensação se aplica no começo do período extraordinário autorizado?", /70%/u],
    [profiles.sudeste, "Quanto vale o benefício diário de alimentação?", /47,30/u],
    [profiles.sul, "Quanto recebo por dia de apoio de refeição?", /49,10/u],
  ] as const) assert.match((await answer(question, profile)).body, expected, question);
});

test("question text cannot override the trusted requester region", async () => {
  const result = await decide({ requestId: "planalto-profile-mismatch", question: "Qual é o acréscimo aplicável às duas primeiras horas adicionais no Planalto Central?",
    asOf: "2026-07-22T10:00:00.000Z", requester: { subjectId: "test", domains: [], ...profiles.sudeste }, history: [] });
  assert.equal(result.kind, "defer");
  if (result.kind !== "defer") return;
  assert.equal(result.handoff.reasonCode, "profile_mismatch");
  assert.match(result.userMessage, /não cobrem.*perfil/iu);
  const trace = getTrace(result.traceId);
  assert.equal(trace?.retrievalDiagnostics?.explicitRegion, "CENTRO_OESTE");
  assert.equal(trace?.retrievalDiagnostics?.resolvedRegion, "SUDESTE");
  assert.ok(trace?.consideredEvidence.some((item) => item.sourceId === "na-agreement-planalto-2025" && item.rejectionCodes?.includes("scope")));
  assert.ok(!trace?.consideredEvidence.some((item) => item.selectedAsEvidence && item.sourceId === "na-agreement-metropolitan-2025"));
  assert.equal(trace?.confidence?.level, "low");
});

test("source usage and diagnostics are backward-compatible additions", async () => {
  const result = await answer("Quanto recebo pelas duas primeiras horas extras autorizadas?");
  assert.equal(result.claims[0]?.evidenceUsage?.[0]?.role, "primary");
  assert.ok(result.claims[0]?.evidenceUsage?.[0]?.citation.quote);
  const trace = getTrace(result.traceId);
  assert.ok((trace?.retrievalDiagnostics?.concepts ?? []).includes("overtime_compensation"));
  assert.ok((trace?.retrievalDiagnostics?.expandedTerms.length ?? 0) > 0);
});
