import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/decide.ts";
import { loadSourceDocuments } from "../src/corpus.ts";
import { resolveEvidence } from "../src/evidence.ts";
import { getTrace } from "../src/traces.ts";

const profiles = {
  sudeste: { legalEntityId: "NA_SERVICOS", baseId: "SUDESTE", relationship: "employee", role: "colaborador" },
  centro: { legalEntityId: "NA_SERVICOS", baseId: "CENTRO_OESTE", relationship: "employee", role: "colaborador" },
  sul: { legalEntityId: "NA_SUL", baseId: "SUL", relationship: "employee", role: "colaborador" },
  apprentice: { legalEntityId: "NA_SUL", baseId: "SUL", relationship: "apprentice", role: "colaborador" },
  intern: { legalEntityId: "NA_NORTE", baseId: "NORTE", relationship: "intern", role: "colaborador" },
};

const cases = [
  ["apprentice journey", "apprentice", "Aprendizes seguem a jornada comum dos empregados ou a jornada definida pelo programa?", /jornada do programa/iu],
  ["pre-entry deadline", "sudeste", "Quantos dias úteis antes da data pretendida a documentação de pré-ingresso precisa estar completa?", /quatro dias úteis/iu],
  ["intern documents", "intern", "Quais documentos são necessários para uma pessoa em estágio?", /instrumento educacional assinado/iu],
  ["identity event", "sudeste", "Qual evento precisa ocorrer antes que a identidade corporativa possa ser provisionada?", /formalização_confirmada/iu],
  ["scale notice", "centro", "Com quantos dias úteis de antecedência uma mudança ordinária de escala deve ser comunicada?", /cinco dias úteis/iu],
  ["daily timekeeping", "sudeste", "Quais marcações devem ser realizadas diariamente no controle de jornada?", /entrada.*fim do intervalo.*saída/iu],
  ["meal value", "sudeste", "Qual é o valor diário do apoio à refeição?", /R\$ 47,30/iu],
  ["intern instrument", "intern", "Qual instrumento é obrigatório para formalizar o estágio?", /instrumento educacional/iu],
  ["apprentice additions", "apprentice", "Quais documentos adicionais são exigidos para aprendiz além dos documentos do empregado?", /comprovante do programa/iu],
  ["termination review", "sudeste", "Em quais casos a revisão humana é obrigatória no desligamento?", /estabilidade.*afastamento/iu],
  ["informal termination", "sudeste", "Uma conversa informal do gestor é suficiente para iniciar o desligamento?", /não comprovam início/iu],
  ["policy live state", "sudeste", "A política de ponto consegue confirmar meu saldo ao vivo ou o estado de uma solicitação?", /não contém espelho individual/iu],
  ["metropolitan overtime", "sudeste", "Qual é o acréscimo aplicável às duas primeiras horas adicionais autorizadas?", /62%/u],
  ["planalto overtime while valid", "centro", "Qual é o acréscimo aplicável às duas primeiras horas adicionais autorizadas?", /55%/u],
  ["coast overtime", "sul", "Qual é o acréscimo aplicável às duas primeiras horas adicionais autorizadas?", /70%/u],
  ["metropolitan meal", "sudeste", "Qual é o valor diário do apoio à refeição?", /47,30/iu],
  ["coast meal", "sul", "Qual é o valor diário do apoio à refeição?", /49,10/iu],
  ["metropolitan scale", "sudeste", "Com quantos dias úteis de antecedência uma mudança ordinária de escala deve ser comunicada?", /quatro dias úteis/iu],
  ["coast scale", "sul", "Com quantos dias úteis de antecedência uma mudança ordinária de escala deve ser comunicada?", /seis dias úteis/iu],
  ["payroll receipt", "sudeste", "Quando o comprovante mensal fica disponível?", /12h/iu],
] as const;

test("governed lexical retrieval answers the named passage regressions with exact evidence", async () => {
  const documents = new Map(loadSourceDocuments().map((document) => [document.sourceId, document]));
  for (const [name, profile, question, expected] of cases) {
    const decision = await decide({
      requestId: `regression-${name}`,
      question,
      asOf: "2026-07-22T10:30:00.000Z",
      requester: { subjectId: "regression", domains: [], ...profiles[profile] },
      history: [],
    });
    assert.equal(decision.kind, "answer", name);
    if (decision.kind !== "answer") continue;
    assert.match(decision.body, expected, name);
    for (const claim of decision.claims) for (const evidence of claim.evidence) {
      const document = documents.get(evidence.sourceId);
      assert.ok(document, name);
      if (document) assert.equal(resolveEvidence(document, evidence), true, name);
    }
    const trace = getTrace(decision.traceId);
    assert.ok(trace?.consideredEvidence.some((item) => item.passageId && item.selectedAsEvidence), name);
  }
});

test("an expired applicable agreement yields an explained, governed defer", async () => {
  const decision = await decide({
    requestId: "regression-expired-planalto",
    question: "Qual é o acréscimo aplicável às duas primeiras horas adicionais autorizadas?",
    asOf: "2026-08-01T10:00:00.000Z",
    requester: { subjectId: "regression", domains: [], ...profiles.centro },
    history: [],
  });
  assert.equal(decision.kind, "defer");
  if (decision.kind !== "defer") return;
  assert.equal(decision.handoff.reasonCode, "missing_source");
  assert.match(decision.userMessage, /fora do período de vigência/iu);
  assert.ok((getTrace(decision.traceId)?.governance.rejectionReasons.expired ?? 0) >= 1);
});
