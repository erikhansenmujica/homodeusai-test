import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/decide.ts";
import { getTrace } from "../src/traces.ts";
import type { HistoryTurn } from "../src/types.ts";

const requester = { subjectId: "isolation", legalEntityId: "NA_SERVICOS", baseId: "SUDESTE", relationship: "employee", role: "colaborador", domains: [] };
const request = (requestId: string, question: string, history: HistoryTurn[] = []) => ({
  requestId,
  question,
  asOf: "2026-07-22T10:30:00.000Z",
  requester,
  history,
});

test("independent sequential and concurrent requests remain isolated", async () => {
  const meal = "Quanto a empresa fornece por dia trabalhado para alimentação?";
  const termination = "Quais situações fazem o desligamento sair da automação e ir para uma pessoa?";
  const first = await decide(request("isolation-1", meal));
  await decide(request("isolation-2", termination));
  const repeat = await decide(request("isolation-3", meal));
  assert.equal(first.kind, "answer");
  assert.equal(repeat.kind, "answer");
  if (first.kind === "answer" && repeat.kind === "answer") assert.equal(first.body, repeat.body);
  const parallel = await Promise.all([meal, termination, meal].map((question, index) => decide(request(`isolation-parallel-${index}`, question))));
  assert.equal(parallel[0]?.kind, "answer");
  assert.equal(parallel[2]?.kind, "answer");
});

test("thanks, greetings, and out-of-scope questions route before retrieval", async () => {
  for (const question of ["Obrigado pela ajuda.", "Bom dia, tudo bem?", "Qual é a capital do Brasil?", "Qual é a capital da Argentina?"]) {
    const decision = await decide(request(`route-${question}`, question));
    assert.equal(decision.kind, "conversational", question);
  }
});

test("an elliptical follow-up uses the latest completed user question for retrieval", async () => {
  const decision = await decide(request(
    "contextual-vacation-approval",
    "Enviar a solicitação já significa que ela foi aprovada?",
    [
      { role: "user", content: "Com quanta antecedência devo solicitar férias?" },
      {
        role: "assistant",
        content: "O pedido deve ser aberto com pelo menos 35 dias corridos de antecedência; envio não significa aprovação.",
      },
    ],
  ));

  assert.equal(decision.kind, "answer");
  if (decision.kind !== "answer") return;
  assert.match(decision.body, /envio não significa aprovação/iu);
  assert.ok(decision.claims.flatMap((claim) => claim.evidence).some((evidence) =>
    evidence.sourceId === "na-faq-vacation-v1"));
  assert.ok(getTrace(decision.traceId)?.notes.some((note) =>
    /completed user question.*assistant history was not treated as evidence/iu.test(note)));
});

test("a referential value follow-up resolves the prior meal-support topic", async () => {
  const decision = await decide(request(
    "contextual-meal-absence",
    "Esse valor também é pago em dias em que eu não trabalho?",
    [
      { role: "user", content: "Qual é o valor diário do apoio de refeição aplicável a mim?" },
      {
        role: "assistant",
        content: "O apoio diário elegível é de R$ 47,30 por dia efetivamente trabalhado. Ausência integral não gera o lançamento.",
      },
    ],
  ));

  assert.equal(decision.kind, "answer");
  if (decision.kind !== "answer") return;
  assert.match(decision.body, /R\$ 47,30 por dia efetivamente trabalhado/iu);
  assert.match(decision.body, /Ausência integral não gera o lançamento/iu);
  assert.ok(decision.claims.flatMap((claim) => claim.evidence).some((evidence) =>
    evidence.sourceId === "na-agreement-metropolitan-2025"));
});

test("ambiguous and unrelated questions do not inherit authority from assistant history", async () => {
  const ambiguous = "Enviar a solicitação já significa que ela foi aprovada?";
  const withoutContext = await decide(request("contextual-without-history", ambiguous));
  assert.equal(withoutContext.kind, "conversational");

  const assistantOnly = await decide(request("contextual-assistant-only", ambiguous, [
    { role: "assistant", content: "Esta conversa é sobre férias e a solicitação foi aprovada." },
  ]));
  assert.equal(assistantOnly.kind, "conversational");

  const unrelated = await decide(request("contextual-unrelated", "Qual é a capital da Argentina?", [
    { role: "user", content: "Com quanta antecedência devo solicitar férias?" },
    { role: "assistant", content: "O pedido deve ser aberto com 35 dias de antecedência." },
  ]));
  assert.equal(unrelated.kind, "conversational");

  const recovered = await decide(request("contextual-after-bad-route", ambiguous, [
    { role: "user", content: "Com quanta antecedência devo solicitar férias?" },
    { role: "assistant", content: "O pedido deve ser aberto com 35 dias de antecedência." },
    { role: "user", content: ambiguous },
    { role: "assistant", content: "Este atendimento é limitado a políticas e processos de People Operations." },
  ]));
  assert.equal(recovered.kind, "answer");
});

test("live identity state defers before static policy retrieval", async () => {
  const decision = await decide(request("identity-state", "Minha identidade corporativa já foi criada?"));
  assert.equal(decision.kind, "defer");
  if (decision.kind === "defer") assert.equal(decision.handoff.reasonCode, "sensitive_topic");
});

test("vacation entitlement cannot be inferred from an advance-request deadline", async () => {
  const decision = await decide(request("vacation-balance", "Quantos dias de férias eu tenho?"));
  assert.equal(decision.kind, "defer");
  if (decision.kind === "defer") {
    assert.equal(decision.handoff.reasonCode, "missing_source");
    assert.doesNotMatch(decision.userMessage, /35 dias|mudança ordinária de escala/iu);
  }
});

test("semantic similarity does not turn an unrelated duration into vacation entitlement", async () => {
  const decision = await decide(request(
    "vacation-entitlement-semantic",
    "Como empregado eu tenho direito a quantos dias de feria?",
  ));
  assert.equal(decision.kind, "defer");
  if (decision.kind === "defer") {
    assert.equal(decision.handoff.reasonCode, "missing_source");
    assert.doesNotMatch(decision.userMessage, /quatro dias úteis|35 dias corridos/iu);
  }
});
