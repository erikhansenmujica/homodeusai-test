import assert from "node:assert/strict";
import test from "node:test";

import { loadSourceDocuments } from "../src/corpus.ts";
import { decide } from "../src/decide.ts";
import { resolveEvidence } from "../src/evidence.ts";
import { ensureRuntimeReady } from "../src/runtime.ts";

const requester = {
  subjectId: "open-world-regression",
  legalEntityId: "NA_SERVICOS",
  baseId: "SUDESTE",
  relationship: "employee",
  role: "colaborador",
  domains: [],
};

const cases = [
  {
    question: "Se eu já sei que faltarei na próxima semana, em que momento e sistema devo registrar essa ausência?",
    sourceId: "na-faq-absence-leave-v1",
    terms: ["Farol", "antes do início", "fluxo seguro"],
  },
  {
    question: "Quais dados do meu cadastro posso pedir para corrigir, e qual tipo exige uma validação mais forte?",
    sourceId: "na-faq-personal-data-v1",
    terms: ["telefone corporativo", "endereço de correspondência", "dados bancários", "validação reforçada"],
  },
  {
    question: "Receber uma minuta do contrato basta para considerar meu vínculo ativo?",
    sourceId: "na-faq-employment-contract-v1",
    terms: ["Não", "Minuta", "assinatura", "ativação"],
  },
  {
    question: "Posso confiar numa resposta antiga do portal sem verificar a fonte novamente?",
    sourceId: "na-faq-other-topics-v1",
    terms: ["aprovada", "vigente", "aplicável"],
  },
  {
    question: "A central de dúvidas consegue calcular o valor exato dos meus recolhimentos individuais?",
    sourceId: "na-faq-social-contributions-v1",
    terms: ["Não", "valores individuais", "comprovante mensal", "canal autorizado"],
  },
  {
    question: "Quem participa da correção do ponto e o simples envio significa que o ajuste terminou?",
    sourceId: "na-faq-timekeeping-v1",
    terms: ["colaborador solicita", "liderança revisa", "time de jornada", "envio não confirma"],
  },
  {
    question: "Uma emergência de escala devidamente registrada continua sujeita aos quatro dias úteis de antecedência?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["quatro dias úteis", "salvo emergência registrada"],
  },
  {
    question: "Uma cópia sem identificação de versão pode prevalecer sobre o instrumento coletivo vigente?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["cópia sem versão não supera este instrumento"],
  },
  {
    question: "Se a marcação do intervalo estiver incompleta, a empresa pode presumir que o intervalo aconteceu?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["marcação incompleta não presume intervalo realizado"],
  },
  {
    question: "Uma alteração local começa a valer antes de ser formalmente publicada?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["alteração local só vale depois de publicação formal"],
  },
  {
    question: "Depois de registrar um risco urgente, posso deixar de procurar primeiro o canal local de emergência?",
    sourceId: "na-safety-process-v2",
    terms: ["procure primeiro o canal local de emergência", "registre o evento no Farol Segurança"],
  },
  {
    question: "Se eu enviar todos os documentos de pré-ingresso no prazo, minha data de início fica automaticamente garantida?",
    sourceId: "na-faq-admission-v1",
    terms: ["Não", "depende de validação", "aprovações do processo"],
  },
  // Protect a channel question from being mistaken for an explicit human-handoff request.
  {
    question: "Preciso pedir a conferência da base de recolhimento de uma competência anterior. Por qual canal faço isso?",
    sourceId: "na-faq-social-contributions-v1",
    terms: ["Doca", "folha", "não calcula valor individual"],
  },
  // Protect a supported vacation edit from the separate unknown-balance boundary.
  {
    question: "Preciso alterar as datas de um pedido de férias que ainda está em rascunho. Em qual sistema faço isso?",
    sourceId: "na-faq-vacation-v1",
    terms: ["Farol", "mudar as datas", "rascunho"],
  },
  // Require the effective-at-event-date rule rather than a nearby schedule-notice clause.
  {
    question: "Uma ocorrência aconteceu antes de a regra local mudar. Qual versão da regra deve ser aplicada?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["evento anterior", "regra vigente na data do fato"],
  },
  // Keep an interval exception question on its directly supported agreement clause.
  {
    question: "Uma redução excepcional do intervalo pode ser aprovada sem que o motivo fique registrado?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["redução excepcional", "fundamento registrado"],
  },
  // Distinguish the general effect of a shift-swap request from live personal status.
  {
    question: "Um pedido de troca de escala, sozinho, comprova que a troca foi aprovada?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["pedido de troca", "não comprova aprovação"],
  },
  // Treat a complete equivalence question as standalone policy guidance.
  {
    question: "Se duas versões equivalentes de uma regra estiverem em análise, o que precisa ser definido antes da conclusão?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["versões equivalentes", "dono de decisão"],
  },
  // Preserve the reconciliation record instead of manufacturing a cross-domain conflict.
  {
    question: "Ao fechar uma conciliação, as fontes consideradas podem ser descartadas?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["resultado conciliado", "mantém as fontes consideradas"],
  },
  // Answer how a deadline is communicated without confusing days with leave entitlement.
  {
    question: "Ao informar um prazo, basta indicar a quantidade de dias sem dizer quando começa a contagem?",
    sourceId: "na-agreement-metropolitan-2025",
    terms: ["prazo informado", "marco inicial"],
  },
] as const;

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("pt-BR");
}

test("learned retrieval answers supported open-world paraphrases without concept-specific routing", async (context) => {
  const runtime = await ensureRuntimeReady();
  if (runtime.retrievalMode !== "learned") {
    context.skip("the learned retrieval adapter is unavailable");
    return;
  }
  const documents = new Map(loadSourceDocuments().map((document) => [document.sourceId, document]));

  for (const [index, testCase] of cases.entries()) {
    await context.test(`${index + 1}: ${testCase.question}`, async () => {
      const decision = await decide({
        requestId: `open-world-${index}-${Date.now()}`,
        question: testCase.question,
        asOf: "2026-07-22T10:30:00.000Z",
        requester,
        history: [],
      });

      assert.equal(decision.kind, "answer");
      if (decision.kind !== "answer") return;
      for (const term of testCase.terms) {
        assert.ok(normalized(decision.body).includes(normalized(term)), `missing answer term: ${term}`);
      }
      const evidence = decision.claims.flatMap((claim) => claim.evidence);
      assert.ok(evidence.some((item) => item.sourceId === testCase.sourceId), testCase.sourceId);
      for (const item of evidence) {
        const document = documents.get(item.sourceId);
        assert.ok(document, item.sourceId);
        assert.equal(resolveEvidence(document!, item), true);
      }
    });
  }
});
