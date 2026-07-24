import type { Decision } from "./types.ts";

const requestCounts = new Map<string, number>();
const requestDurationBuckets = new Map<string, number>();
const decisionCounts = new Map<string, number>();
const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000];

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function routeLabel(method: string | undefined, pathname: string): string {
  if (pathname === "/v1/decide") return "decide";
  if (/^\/v1\/traces\/[^/]+$/u.test(pathname)) return "trace";
  if (/^\/v1\/handoffs\/[^/]+\/resolve$/u.test(pathname)) return "handoff_resolve";
  if (/^\/v1\/handoffs\/[^/]+$/u.test(pathname)) return "handoff";
  if (/^\/api\/sources\/[^/]+\/[^/]+$/u.test(pathname)) return "source";
  if (pathname === "/readyz") return "readiness";
  if (pathname === "/healthz") return "liveness";
  if (pathname === "/metrics") return "metrics";
  if (pathname.startsWith("/assets/") || pathname === "/favicon.svg") return "asset";
  if (method === "GET" && (pathname === "/" || pathname.startsWith("/sources"))) return "workbench";
  return "other";
}

export function recordRequest(route: string, status: number, durationMs: number): void {
  increment(requestCounts, `${route}:${status}`);
  for (const bucket of LATENCY_BUCKETS_MS) {
    if (durationMs <= bucket) increment(requestDurationBuckets, `${route}:${bucket}`);
  }
  increment(requestDurationBuckets, `${route}:+Inf`);
}

export function recordDecision(decision: Decision): void {
  const reason = decision.kind === "defer" ? decision.handoff.reasonCode : "none";
  increment(decisionCounts, `${decision.kind}:${reason}`);
}

function metricLines(
  name: string,
  help: string,
  values: Map<string, number>,
  labels: (key: string) => string,
): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
    ...[...values.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${name}{${labels(key)}} ${value}`),
  ];
}

export function renderMetrics(runtimeStatus: string, retrievalMode: string | undefined): string {
  const lines = [
    ...metricLines(
      "nexo_http_requests_total",
      "Completed HTTP requests by normalized route and status.",
      requestCounts,
      (key) => {
        const [route, status] = key.split(":");
        return `route="${route}",status="${status}"`;
      },
    ),
    ...metricLines(
      "nexo_http_request_duration_bucket_total",
      "Cumulative HTTP request duration buckets in milliseconds.",
      requestDurationBuckets,
      (key) => {
        const [route, le] = key.split(":");
        return `route="${route}",le="${le}"`;
      },
    ),
    ...metricLines(
      "nexo_decisions_total",
      "Completed decisions by kind and public defer reason.",
      decisionCounts,
      (key) => {
        const [kind, reason] = key.split(":");
        return `kind="${kind}",reason="${reason}"`;
      },
    ),
    "# HELP nexo_runtime_ready Whether the governed decision runtime is ready.",
    "# TYPE nexo_runtime_ready gauge",
    `nexo_runtime_ready{status="${runtimeStatus}",retrieval_mode="${retrievalMode ?? "none"}"} ${
      runtimeStatus.startsWith("ready_") ? 1 : 0}`,
  ];
  return `${lines.join("\n")}\n`;
}
