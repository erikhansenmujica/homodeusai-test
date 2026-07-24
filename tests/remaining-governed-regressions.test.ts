import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/decide.ts";
import { getTrace } from "../src/traces.ts";

const profiles = {
  intern: { legalEntityId: "NA_NORTE", baseId: "NORTE", relationship: "intern", role: "colaborador" },
  sudeste: { legalEntityId: "NA_SERVICOS", baseId: "SUDESTE", relationship: "employee", role: "colaborador" },
  centro: { legalEntityId: "NA_SERVICOS", baseId: "CENTRO_OESTE", relationship: "employee", role: "colaborador" },
  sul: { legalEntityId: "NA_SUL", baseId: "SUL", relationship: "employee", role: "colaborador" },
  candidate: { legalEntityId: "NA_SERVICOS", baseId: "SUDESTE", relationship: "candidate", role: "candidato" },
};
async function ask(question: string, profile: keyof typeof profiles) {
  return decide({ requestId: `remaining-${profile}-${question}`, question, asOf: "2026-07-22T10:30:00.000Z",
    requester: { subjectId: "remaining", domains: [], ...profiles[profile] }, history: [] });
}

test("relationship-specific and percentage evidence beat generic topical passages", async () => {
  for (const question of [
    "O estagiário acumula banco de horas?",
    "Estagiário participa do banco de horas?",
    "Pessoa em estágio pode usar banco de horas?",
  ]) {
    const intern = await ask(question, "intern");
    assert.equal(intern.kind, "answer", question);
    if (intern.kind === "answer") {
      assert.match(intern.body, /(?:sem banco de horas|não participa do banco de horas)/iu, question);
      assert.doesNotMatch(intern.body, /registro não substitui autorização/iu, question);
      assert.ok(
        intern.claims.flatMap((claim) => claim.evidence).some((evidence) =>
          ["na-faq-overtime-v1", "na-timekeeping-policy-v4"].includes(evidence.sourceId)),
        question,
      );
    }
  }
  for (const [profile, expected] of [["sudeste", /62%/u], ["centro", /55%/u], ["sul", /70%/u]] as const) {
    const decision = await ask("Quanto a empresa acrescenta nas primeiras horas que eu trabalhar depois do meu horário?", profile);
    assert.equal(decision.kind, "answer", profile);
    if (decision.kind === "answer") assert.match(decision.body, expected, profile);
  }
});

test("employment relationship and protected medical-channel questions remain in People Operations scope", async () => {
  for (const [question, expectedBody, expectedSource] of [
    [
      "O nome do projeto pode mudar o meu tipo de vínculo?",
      /nome do projeto não altera o vínculo/iu,
      "na-faq-employment-contract-v1",
    ],
    [
      "A alocação ou o nome de um projeto altera a relação de trabalho?",
      /nome do projeto não altera o vínculo/iu,
      "na-faq-employment-contract-v1",
    ],
    [
      "O gestor pode receber um documento médico pelo chat?",
      /documento segue pelo canal protegido/iu,
      "na-faq-absence-leave-v1",
    ],
    [
      "Posso mandar um atestado ao gestor por mensagem?",
      /documento segue pelo canal protegido/iu,
      "na-faq-absence-leave-v1",
    ],
  ] as const) {
    const decision = await ask(question, "sudeste");
    assert.equal(decision.kind, "answer", question);
    if (decision.kind === "answer") {
      assert.match(decision.body, expectedBody, question);
      assert.ok(
        decision.claims.flatMap((claim) => claim.evidence).some((evidence) => evidence.sourceId === expectedSource),
        question,
      );
    }
  }
});

test("a source-defined candidate document set satisfies list questions without inventing a fixed checklist", async () => {
  for (const question of [
    "Como candidato, quais documentos devo enviar?",
    "Existe uma lista fixa de documentos para candidatos?",
  ]) {
    const decision = await ask(question, "candidate");
    assert.equal(decision.kind, "answer", question);
    if (decision.kind === "answer") {
      assert.match(decision.body, /somente os itens explicitamente solicitados no convite/iu, question);
      assert.ok(
        decision.claims.flatMap((claim) => claim.evidence).some((evidence) =>
          evidence.sourceId === "na-admission-documents-v6"),
        question,
      );
    }
  }
});

test("channel conflicts, thanks, and individual state route safely", async () => {
  const channel = await ask("Onde devo enviar meu pacote de documentos de ingresso?", "candidate");
  assert.equal(channel.kind, "defer");
  if (channel.kind === "defer") assert.equal(channel.handoff.reasonCode, "conflicting_source");
  const thanks = await ask("Obrigado pela ajuda.", "sudeste");
  assert.equal(thanks.kind, "conversational");
  if (thanks.kind === "conversational") assert.match(thanks.body, /de nada/iu);
  const identity = await ask("Minha identidade corporativa já foi criada?", "sudeste");
  assert.equal(identity.kind, "defer");
  assert.equal(getTrace(identity.traceId)?.decisionKind, "defer");
});
