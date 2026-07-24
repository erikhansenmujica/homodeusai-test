import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../src/decide.ts";

const requester = { subjectId: "isolation", legalEntityId: "NA_SERVICOS", baseId: "SUDESTE", relationship: "employee", role: "colaborador", domains: [] };
const request = (requestId: string, question: string) => ({ requestId, question, asOf: "2026-07-22T10:30:00.000Z", requester, history: [] });

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
