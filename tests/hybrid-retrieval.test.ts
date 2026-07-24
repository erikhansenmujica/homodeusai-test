import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/decide.ts";
import { semanticIndex } from "../src/semantic.ts";
import { loadSourceDocuments } from "../src/corpus.ts";

const requester = { subjectId: "hybrid", legalEntityId: "NA_SERVICOS", baseId: "SUDESTE", relationship: "employee", role: "colaborador", domains: [] };
const request = (question: string) => ({ requestId: `hybrid-${question}`, question, asOf: "2026-07-22T10:30:00.000Z", requester, history: [] });

test("offline passage embeddings are reusable and retain passage identities", () => {
  const documents = loadSourceDocuments();
  const index = semanticIndex(documents);
  assert.equal(semanticIndex(documents), index);
  const result = index.search("retorno do intervalo no ponto", 10);
  assert.ok(result.some((candidate) => candidate.document.sourceId === "na-timekeeping-policy-v4"));
  assert.ok(result.every((candidate) => candidate.passage.id.startsWith(candidate.document.sourceId)));
});

test("hybrid path answers paraphrases while live personal state always defers", async () => {
  for (const [question, expected] of [
    ["Preciso marcar o retorno do intervalo?", /fim do intervalo/iu],
    ["Como a empresa formaliza a relação com uma pessoa estagiária?", /instrumento educacional/iu],
    ["Quando um desligamento não pode ser processado automaticamente?", /estabilidade.*afastamento/iu],
    ["Quanto é pago a mais nas primeiras horas trabalhadas depois do expediente?", /62%/u],
  ] as const) {
    const decision = await decide(request(question));
    assert.equal(decision.kind, "answer", question);
    if (decision.kind === "answer") assert.match(decision.body, expected, question);
  }
  for (const question of [
    "Minha solicitação de correção de ponto foi aprovada?",
    "Minha correção de ponto já foi processada?",
    "O RH aprovou meu ajuste de jornada?",
    "Qual é o andamento da minha solicitação?",
    "Meu pedido ainda está pendente?",
    "Já corrigiram minhas horas?",
  ]) {
    const decision = await decide(request(question));
    assert.equal(decision.kind, "defer", question);
    if (decision.kind === "defer") assert.equal(decision.handoff.reasonCode, "sensitive_topic", question);
  }
});
