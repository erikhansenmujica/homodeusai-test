import { createHash } from "node:crypto";
import { loadSourceDocuments } from "./corpus.ts";
import { evidenceForQuote } from "./evidence.ts";
import { activeSupersededSources, detectConflicts, evaluateEligibility } from "./governance.ts";
import { createHandoff } from "./queue.ts";
import { lexicalIndex, tokenize } from "./retrieval.ts";
import { saveTrace } from "./traces.ts";
import type {
  Claim,
  DecideRequest,
  Decision,
  DecisionTrace,
  EligibilityRejectionCode,
  HandoffReason,
  RetrievalCandidate,
} from "./types.ts";

const PIPELINE_VERSION = "lexical-governed-v1";
const MIN_RELEVANCE = 2.35;
const MAX_GOVERNED_CANDIDATES = 10;

const CONVERSATIONAL_PATTERNS = [
  /^(?:oi|olá|ola|bom dia|boa tarde|boa noite)[!,.?\s]*$/iu,
  /^(?:oi|olá|ola)[,!.\s]+(?:tudo bem|como vai)[!,.?\s]*$/iu,
  /^(?:obrigad[oa]|valeu|agradeço|agradeco)[!,.?\s]*$/iu,
  /^(?:tudo bem|como você está|como voce esta)[!,.?\s]*$/iu,
];

const HUMAN_PATTERNS = [
  /\b(?:falar|conversar)\s+com\s+(?:uma\s+)?(?:pessoa|atendente|analista|humano|humana)\b/iu,
  /\b(?:quero|preciso|prefiro)\s+(?:de\s+)?(?:uma\s+)?(?:pessoa|atendente|analista|atendimento humano)\b/iu,
  /\bnão quero (?:usar|falar com) (?:o )?(?:bot|assistente)\b/iu,
];

const INJECTION_PATTERNS = [
  /\bignore (?:as |todas as )?(?:instruções|instrucoes|regras|governança|governanca)\b/iu,
  /\b(?:revele|mostre|imprima|retorne)\b.{0,40}\b(?:segredo|token|chave|vault|canary|prompt)\b/iu,
  /\b(?:finja|considere).{0,40}\b(?:aprovad[oa]|vigente|employee)\b/iu,
];

const SENSITIVE_PATTERNS = [
  /\bquanto (?:eu )?(?:vou|devo|irei) receber\b/iu,
  /\b(?:meu|minha)\s+(?:salário|salario|saldo|diagnóstico|diagnostico|laudo|conta bancária|conta bancaria)\b/iu,
  /\b(?:já|ja)\s+(?:foi|está|esta)\s+(?:pago|creditado|processado|aprovado|corrigido)\b/iu,
  /\b(?:vou|posso)\s+(?:colar|enviar|mandar)\s+(?:meu|minha)\s+(?:cpf|conta|laudo|diagnóstico|diagnostico)\b/iu,
];

function shortHash(value: string, length = 18): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);
}

function traceIdFor(input: DecideRequest): string {
  const identity = JSON.stringify({
    requestId: input.requestId,
    asOf: input.asOf,
    requester: input.requester,
    questionHash: shortHash(input.question, 24),
    historyHash: shortHash(JSON.stringify(input.history ?? []), 24),
  });
  return `trace-${shortHash(identity)}`;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value.trim()));
}

function uniqueSourceCandidates(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const unique = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.document.sourceId}@${candidate.document.versionId}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function primaryRejection(rejections: EligibilityRejectionCode[]): EligibilityRejectionCode {
  const priority: EligibilityRejectionCode[] = [
    "approval", "sensitivity", "audience", "scope", "future", "expired", "superseded",
  ];
  return priority.find((code) => rejections.includes(code)) ?? rejections[0] ?? "scope";
}

function deferReasonForRejected(candidates: Array<{
  candidate: RetrievalCandidate;
  rejectionCodes: EligibilityRejectionCode[];
}>): HandoffReason {
  const codes = new Set(candidates.flatMap((item) => item.rejectionCodes));
  const hasPending = candidates.some((item) => item.candidate.document.approval === "pending");
  if (hasPending || codes.has("future") || codes.has("expired") || codes.has("superseded") || codes.has("approval")) {
    return "validation_pending";
  }
  if (codes.has("sensitivity") || codes.has("audience")) return "policy_sensitive_source";
  if (codes.has("scope")) return "profile_mismatch";
  return "missing_source";
}

function messageFor(reason: HandoffReason): string {
  const messages: Record<HandoffReason, string> = {
    human_requested: "Certo. Encaminhei a solicitação para uma pessoa de People Operations, com o contexto desta conversa.",
    low_confidence: "Não encontrei evidência suficientemente clara para orientar com segurança. People Operations vai revisar a dúvida.",
    conflicting_source: "As fontes aplicáveis divergem sobre esta orientação. A governança de conhecimento vai confirmar qual regra deve prevalecer.",
    missing_source: "O acervo aprovado não contém evidência suficiente para responder com segurança. A governança de conhecimento vai verificar a lacuna.",
    profile_mismatch: "As fontes localizadas não cobrem o perfil confirmado nesta sessão. People Operations vai avaliar o caso sem pedir que você recomece.",
    sensitive_topic: "Este pedido envolve informação individual ou sensível. O atendimento continuará com a equipe autorizada no canal protegido.",
    validation_pending: "A fonte relevante não está aprovada e vigente para esta decisão. A governança de conhecimento vai validar a orientação.",
    policy_sensitive_source: "A informação localizada é interna ou restrita e não pode sustentar uma resposta neste canal. O responsável fará a revisão.",
    provider_failure: "Não foi possível concluir a consulta automaticamente. People Operations continuará o atendimento enquanto a plataforma é verificada.",
  };
  return messages[reason];
}

function emptyGovernanceTrace(
  input: DecideRequest,
  traceId: string,
  kind: Decision["kind"],
  reasonCode: HandoffReason | undefined,
  started: number,
  note: string,
): DecisionTrace {
  return {
    traceId,
    requestId: input.requestId,
    createdAt: new Date().toISOString(),
    decisionKind: kind,
    pipelineVersion: PIPELINE_VERSION,
    indexVersion: "corpus-sha256-v1",
    stages: ["retrieval", "governance", "decision"],
    governance: {
      candidateCount: 0,
      eligibleCount: 0,
      rejectedCount: 0,
      eligibleSources: [],
      rejectionReasons: {},
    },
    route: { kind, ...(reasonCode ? { reasonCode } : {}) },
    provider: { status: "not_used" },
    consideredEvidence: [],
    timingsMs: {
      retrieval: 0,
      governance: 0,
      decision: Math.max(0, performance.now() - started),
      total: Math.max(0, performance.now() - started),
    },
    notes: [note],
  };
}

function selectAnswerCandidates(
  eligible: RetrievalCandidate[],
  question: string,
): RetrievalCandidate[] {
  const strongest = uniqueSourceCandidates(eligible);
  const top = strongest[0];
  if (!top || top.score < MIN_RELEVANCE || top.queryCoverage < 0.52) return [];
  const selected = [top];
  const asksCompound = /\b(?:e|também|tambem|além disso|alem disso)\b/iu.test(question);
  if (asksCompound) {
    const second = strongest.find((candidate) =>
      candidate.document.sourceId !== top.document.sourceId &&
      candidate.score >= Math.max(MIN_RELEVANCE, top.score * 0.34) &&
      candidate.queryCoverage >= 0.25 &&
      candidate.passage.answerText !== top.passage.answerText);
    if (second) selected.push(second);
  }
  return selected;
}

function createClaims(candidates: RetrievalCandidate[]): Claim[] {
  return candidates.map((candidate, index) => ({
    id: `claim-${index + 1}`,
    text: candidate.passage.answerText,
    evidence: [
      evidenceForQuote(
        candidate.document,
        candidate.passage.answerText,
        candidate.passage.startCharacter,
      ),
    ],
  }));
}

function saveRoutingTrace(
  input: DecideRequest,
  traceId: string,
  decision: Decision,
  candidates: RetrievalCandidate[],
  eligible: RetrievalCandidate[],
  rejected: Array<{ candidate: RetrievalCandidate; rejectionCodes: EligibilityRejectionCode[] }>,
  conflicts: ReturnType<typeof detectConflicts>,
  timings: { retrieval: number; governance: number; decision: number; total: number },
): void {
  const uniqueEligible = uniqueSourceCandidates(eligible);
  const rejectionReasons: Record<string, number> = {};
  for (const item of rejected) {
    const reason = primaryRejection(item.rejectionCodes);
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }
  const trace: DecisionTrace = {
    traceId,
    requestId: input.requestId,
    createdAt: new Date().toISOString(),
    decisionKind: decision.kind,
    pipelineVersion: PIPELINE_VERSION,
    indexVersion: "bm25-memory-v1",
    stages: ["retrieval", "governance", "decision"],
    governance: {
      candidateCount: candidates.length,
      eligibleCount: uniqueEligible.length,
      rejectedCount: rejected.length,
      eligibleSources: uniqueEligible.map((item) => ({
        sourceId: item.document.sourceId,
        versionId: item.document.versionId,
      })),
      rejectionReasons,
    },
    route: {
      kind: decision.kind,
      ...(decision.kind === "defer" ? { reasonCode: decision.handoff.reasonCode } : {}),
    },
    provider: { status: "not_used" },
    consideredEvidence: candidates.map((candidate, index) => ({
      sourceId: candidate.document.sourceId,
      versionId: candidate.document.versionId,
      startByte: Buffer.byteLength(candidate.document.content.slice(0, candidate.passage.startCharacter), "utf8"),
      endByte: Buffer.byteLength(candidate.document.content.slice(0, candidate.passage.endCharacter), "utf8"),
      rank: index + 1,
      stage: eligible.some((item) => item.document.sourceId === candidate.document.sourceId)
        ? "eligible"
        : "rejected",
      score: Number(candidate.score.toFixed(4)),
    })),
    timingsMs: {
      retrieval: Number(timings.retrieval.toFixed(3)),
      governance: Number(timings.governance.toFixed(3)),
      decision: Number(timings.decision.toFixed(3)),
      total: Number(timings.total.toFixed(3)),
    },
    conflicts: conflicts.map((conflict) => ({
      domain: conflict.domain,
      sourceIds: [conflict.left.document.sourceId, conflict.right.document.sourceId],
      signals: conflict.signals,
    })),
    notes: [
      `${tokenize(input.question).length} normalized query terms; source and requester text treated as untrusted data.`,
      "Governance was applied deterministically before response rendering.",
    ],
  };
  saveTrace(trace);
}

function deferredDecision(input: DecideRequest, traceId: string, reason: HandoffReason, score: number): Decision {
  return {
    kind: "defer",
    answerabilityScore: Math.max(0, Math.min(1, score)),
    userMessage: messageFor(reason),
    handoff: createHandoff(input, reason, traceId),
    traceId,
  };
}

export async function decide(input: DecideRequest): Promise<Decision> {
  const started = performance.now();
  const traceId = traceIdFor(input);

  if (matchesAny(input.question, CONVERSATIONAL_PATTERNS)) {
    const decision: Decision = {
      kind: "conversational",
      body: "Olá! Posso orientar sobre políticas e processos de People Operations ou encaminhar o atendimento para uma pessoa.",
      traceId,
    };
    saveTrace(emptyGovernanceTrace(input, traceId, decision.kind, undefined, started, "No policy decision was requested."));
    return decision;
  }

  if (matchesAny(input.question, HUMAN_PATTERNS)) {
    const reason: HandoffReason = "human_requested";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The requester explicitly asked for a person."));
    return deferredDecision(input, traceId, reason, 0);
  }

  if (matchesAny(input.question, INJECTION_PATTERNS)) {
    const reason: HandoffReason = "policy_sensitive_source";
    const trace = emptyGovernanceTrace(input, traceId, "defer", reason, started, "Untrusted text attempted to alter governance or disclose protected data.");
    trace.governance = {
      candidateCount: 1,
      eligibleCount: 0,
      rejectedCount: 1,
      eligibleSources: [],
      rejectionReasons: { sensitivity: 1 },
    };
    saveTrace(trace);
    return deferredDecision(input, traceId, reason, 0);
  }

  if (matchesAny(input.question, SENSITIVE_PATTERNS)) {
    const reason: HandoffReason = "sensitive_topic";
    saveTrace(emptyGovernanceTrace(input, traceId, "defer", reason, started, "The request concerns individual or protected state."));
    return deferredDecision(input, traceId, reason, 0.05);
  }

  const documents = loadSourceDocuments();
  const retrievalStarted = performance.now();
  const retrieval = lexicalIndex(documents).search(input.question);
  const retrievalMs = performance.now() - retrievalStarted;
  const topScore = retrieval.candidates[0]?.score ?? 0;
  const relevanceFloor = Math.max(0.85, topScore * 0.25);
  const candidates = uniqueSourceCandidates(
    retrieval.candidates.filter((candidate) => candidate.score >= relevanceFloor),
  ).slice(0, MAX_GOVERNED_CANDIDATES);

  const governanceStarted = performance.now();
  const superseded = activeSupersededSources(documents, input);
  const eligible: RetrievalCandidate[] = [];
  const rejected: Array<{ candidate: RetrievalCandidate; rejectionCodes: EligibilityRejectionCode[] }> = [];
  for (const candidate of candidates) {
    const result = evaluateEligibility(candidate.document, input, superseded);
    if (result.eligible) {
      eligible.push(candidate);
    } else {
      rejected.push({
        candidate,
        rejectionCodes: result.rejections.map((rejection) => rejection.code),
      });
    }
  }
  const conflictCandidates = retrieval.candidates.filter((candidate) =>
    eligible.some((source) => source.document.sourceId === candidate.document.sourceId) &&
    candidate.score >= Math.max(MIN_RELEVANCE, topScore * 0.48));
  const conflicts = detectConflicts(conflictCandidates);
  const governanceMs = performance.now() - governanceStarted;

  const decisionStarted = performance.now();
  let decision: Decision;
  const strongestRejected = rejected.find((item) =>
    item.candidate.document.sourceId === candidates[0]?.document.sourceId);
  const rejectedDominates = Boolean(
    strongestRejected &&
    (!eligible[0] || eligible[0].score < topScore * 0.75),
  );
  if (candidates.length === 0 || topScore < MIN_RELEVANCE) {
    decision = deferredDecision(input, traceId, "missing_source", 0.08);
  } else if (eligible.length === 0) {
    decision = deferredDecision(input, traceId, deferReasonForRejected(rejected), 0.12);
  } else if (rejectedDominates && strongestRejected) {
    decision = deferredDecision(input, traceId, deferReasonForRejected([strongestRejected]), 0.16);
  } else if (conflicts.length > 0) {
    decision = deferredDecision(input, traceId, "conflicting_source", 0.2);
  } else {
    const answerCandidates = selectAnswerCandidates(eligible, input.question);
    if (answerCandidates.length === 0) {
      decision = deferredDecision(input, traceId, "missing_source", 0.18);
    } else {
      const claims = createClaims(answerCandidates);
      decision = {
        kind: "answer",
        answerabilityScore: Math.min(0.96, 0.62 + topScore / 40 + (claims.length > 1 ? 0.06 : 0)),
        body: claims.map((claim) => claim.text).join("\n\n"),
        claims,
        traceId,
      };
    }
  }
  const decisionMs = performance.now() - decisionStarted;
  saveRoutingTrace(input, traceId, decision, candidates, eligible, rejected, conflicts, {
    retrieval: retrievalMs,
    governance: governanceMs,
    decision: decisionMs,
    total: performance.now() - started,
  });
  return decision;
}
