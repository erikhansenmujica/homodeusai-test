import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { activeHandoffTraceIds } from "./queue.ts";
import type { DecisionTrace } from "./types.ts";

const MAX_TRACES = 500;
const traces = new Map<string, DecisionTrace>();

export interface TraceRepository {
  save(trace: DecisionTrace): void;
  get(traceId: string): DecisionTrace | undefined;
  assertHealthy(): void;
}

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

function pruneTraceFiles(maxTraces = MAX_TRACES): void {
  const directory = traceDirectory();
  if (!existsSync(directory)) return;
  const protectedTraceIds = activeHandoffTraceIds();
  const files = readdirSync(directory)
    .filter((name) => /^trace-[a-z0-9-]{8,96}\.json$/u.test(name))
    .map((name) => ({ name, modifiedAt: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => left.modifiedAt - right.modifiedAt);
  let removable = files.length - maxTraces;
  for (const file of files) {
    if (removable <= 0) break;
    const traceId = file.name.slice(0, -".json".length);
    if (protectedTraceIds.has(traceId)) continue;
    rmSync(join(directory, file.name), { force: true });
    traces.delete(traceId);
    removable -= 1;
  }
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
  pruneTraceFiles();
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

export function assertTraceStoreHealthy(): void {
  const directory = traceDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(directory).filter((candidate) => candidate.endsWith(".json"))) {
    if (!/^trace-[a-z0-9-]{8,96}\.json$/u.test(name)) {
      throw new Error(`trace store contains an unexpected record: ${name}`);
    }
    const parsed = JSON.parse(readFileSync(join(directory, name), "utf8")) as Partial<DecisionTrace>;
    if (
      typeof parsed.traceId !== "string"
      || `${parsed.traceId}.json` !== name
      || !Array.isArray(parsed.stages)
    ) {
      throw new Error(`trace store contains an invalid record: ${name}`);
    }
  }
  const probe = join(directory, `.trace-health-${process.pid}`);
  writeFileSync(probe, "ok", { encoding: "utf8", mode: 0o600 });
  rmSync(probe, { force: true });
}

export const fileTraceRepository: TraceRepository = {
  save: saveTrace,
  get: getTrace,
  assertHealthy: assertTraceStoreHealthy,
};

export function resetTracesForTest(): void {
  traces.clear();
  rmSync(traceDirectory(), { recursive: true, force: true });
}
