import { createHash } from "node:crypto";
import { createHandoff } from "./queue.ts";
import type { DecideRequest, Decision } from "./types.ts";

function traceIdFor(input: DecideRequest): string {
  return `trace-${createHash("sha256").update(input.requestId).digest("hex").slice(0, 16)}`;
}

/**
 * Candidate entry point.
 *
 * The starter is intentionally safe and uncompetitive. It satisfies the API
 * contract and demonstrates an idempotent handoff, but earns no autonomous
 * answer coverage. Replace this policy with your own implementation.
 */
export async function decide(input: DecideRequest): Promise<Decision> {
  const traceId = traceIdFor(input);
  return {
    kind: "defer",
    answerabilityScore: 0,
    userMessage: "Não encontrei evidência suficiente para responder com segurança. Encaminhei a solicitação para análise.",
    handoff: createHandoff(input, "low_confidence", traceId),
    traceId,
  };
}
