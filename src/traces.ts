import type { DecisionTrace } from "./types.ts";

const MAX_TRACES = 500;
const traces = new Map<string, DecisionTrace>();

export function saveTrace(trace: DecisionTrace): void {
  traces.set(trace.traceId, trace);
  while (traces.size > MAX_TRACES) {
    const oldest = traces.keys().next().value;
    if (typeof oldest !== "string") break;
    traces.delete(oldest);
  }
}

export function getTrace(traceId: string): DecisionTrace | undefined {
  return traces.get(traceId);
}
