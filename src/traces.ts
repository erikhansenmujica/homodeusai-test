import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DecisionTrace } from "./types.ts";

const MAX_TRACES = 500;
const traces = new Map<string, DecisionTrace>();

function traceDirectory(): string {
  return join(resolve(process.env.RUNTIME_STATE_PATH ?? process.env.INDEX_PATH ?? "/tmp/nexo-index"), "traces");
}

function validTraceId(traceId: string): boolean {
  return /^trace-[a-z0-9-]{8,96}$/u.test(traceId);
}

function tracePath(traceId: string): string {
  if (!validTraceId(traceId)) throw new Error("invalid trace identifier");
  return join(traceDirectory(), `${traceId}.json`);
}

export function saveTrace(trace: DecisionTrace): void {
  if (!validTraceId(trace.traceId)) throw new Error("invalid trace identifier");
  const directory = traceDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = tracePath(trace.traceId);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(trace, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, destination);
  traces.set(trace.traceId, trace);
  while (traces.size > MAX_TRACES) {
    const oldest = traces.keys().next().value;
    if (typeof oldest !== "string") break;
    traces.delete(oldest);
  }
}

export function getTrace(traceId: string): DecisionTrace | undefined {
  if (!validTraceId(traceId)) return undefined;
  const cached = traces.get(traceId);
  if (cached) return cached;
  const path = tracePath(traceId);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DecisionTrace;
    if (parsed.traceId !== traceId || !Array.isArray(parsed.stages)) return undefined;
    traces.set(traceId, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export function resetTracesForTest(): void {
  traces.clear();
  rmSync(traceDirectory(), { recursive: true, force: true });
}
