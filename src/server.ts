import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDecideRequest, validateDecision } from "./contract.ts";
import { loadSourceDocuments } from "./corpus.ts";
import { decide } from "./decide.ts";
import { renderMetrics, recordDecision, recordRequest, routeLabel } from "./metrics.ts";
import { getHandoff, IdempotencyConflictError, resolveHandoff } from "./queue.ts";
import { runtimeSnapshot, startRuntimeInitialization } from "./runtime.ts";
import { getGovernedSource } from "./source-access.ts";
import { getTrace } from "./traces.ts";
import { renderWorkbench } from "./ui.ts";

const PORT = Number(process.env.PORT) || 8080;
const MAX_BODY_BYTES = 256 * 1024;
const startedAt = Date.now();
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_ARCHIVE_PATH = process.env.CANDIDATE_ARCHIVE_PATH?.trim() || join(ROOT, "dist", "nexo-atlantico-knowledge-case.tgz");
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const ASSETS = new Map<string, { file: string; contentType: string; maxAge: number }>([
  ["/assets/workbench.css", { file: join(ROOT, "src", "public", "workbench.css"), contentType: "text/css; charset=utf-8", maxAge: 300 }],
  ["/assets/workbench.js", { file: join(ROOT, "src", "public", "workbench.js"), contentType: "text/javascript; charset=utf-8", maxAge: 300 }],
  ["/assets/workbench/api.js", { file: join(ROOT, "src", "public", "workbench", "api.js"), contentType: "text/javascript; charset=utf-8", maxAge: 300 }],
  ["/assets/workbench/session.js", { file: join(ROOT, "src", "public", "workbench", "session.js"), contentType: "text/javascript; charset=utf-8", maxAge: 300 }],
  ["/favicon.svg", { file: join(ROOT, "src", "public", "favicon.svg"), contentType: "image/svg+xml; charset=utf-8", maxAge: 86_400 }],
]);

function securityHeaders(res: ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("content-security-policy", CONTENT_SECURITY_POLICY);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

const server = createServer(async (req, res) => {
  const requestStarted = performance.now();
  let loggedDecisionKind = "none";
  let loggedReasonCode = "none";
  const correlationId = /^[a-zA-Z0-9._:-]{8,128}$/u.test(String(req.headers["x-request-id"] ?? ""))
    ? String(req.headers["x-request-id"])
    : randomUUID();
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const normalizedRoute = routeLabel(req.method, requestUrl.pathname);
  securityHeaders(res);
  res.setHeader("x-request-id", correlationId);
  res.once("finish", () => {
    const durationMs = performance.now() - requestStarted;
    recordRequest(normalizedRoute, res.statusCode, durationMs);
    console.log(JSON.stringify({
      level: "info",
      event: "http_request",
      correlationId,
      method: req.method,
      route: normalizedRoute,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(3)),
      decisionKind: loggedDecisionKind,
      reasonCode: loggedReasonCode,
      retrievalMode: runtimeSnapshot().retrievalMode ?? "none",
    }));
  });
  try {
    const url = requestUrl;
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, { status: "ok", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      const state = runtimeSnapshot();
      const ready = state.status === "ready_learned" || state.status === "ready_degraded";
      return json(res, ready ? 200 : 503, {
        status: state.status,
        retrievalMode: state.retrievalMode ?? null,
        corpusVersion: state.corpusVersion ?? null,
        documents: state.documents ?? 0,
        passages: state.passages ?? 0,
        initializationMs: state.initializationMs ?? null,
        ...(state.status === "failed" ? { error: "runtime_initialization_failed" } : {}),
      });
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      const state = runtimeSnapshot();
      const body = renderMetrics(state.status, state.retrievalMode);
      res.writeHead(200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(body);
    }

    const asset = req.method === "GET" ? ASSETS.get(url.pathname) : undefined;
    if (asset) {
      const content = readFileSync(asset.file);
      res.writeHead(200, {
        "content-type": asset.contentType,
        "cache-control": `public, max-age=${asset.maxAge}`,
      });
      return res.end(content);
    }

    if (
      req.method === "GET"
      && (
        url.pathname === "/"
        || url.pathname === "/sources"
        || /^\/sources\/[^/]+\/[^/]+$/u.test(url.pathname)
      )
    ) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      return res.end(renderWorkbench());
    }

    if (req.method === "GET" && url.pathname === "/candidate-kit.tgz") {
      if (!CANDIDATE_ARCHIVE_PATH || !existsSync(CANDIDATE_ARCHIVE_PATH)) {
        return json(res, 404, { error: "candidate_kit_not_available" });
      }
      const archive = readFileSync(CANDIDATE_ARCHIVE_PATH);
      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": String(archive.byteLength),
        "content-disposition": 'attachment; filename="nexo-atlantico-knowledge-case.tgz"',
        "cache-control": "public, max-age=300",
      });
      return res.end(archive);
    }

    if (req.method === "GET" && url.pathname === "/candidate-kit.tgz.sha256") {
      if (!CANDIDATE_ARCHIVE_PATH || !existsSync(CANDIDATE_ARCHIVE_PATH)) {
        return json(res, 404, { error: "candidate_kit_not_available" });
      }
      const digest = createHash("sha256").update(readFileSync(CANDIDATE_ARCHIVE_PATH)).digest("hex");
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      return res.end(`${digest}  nexo-atlantico-knowledge-case.tgz\n`);
    }

    if (req.method === "GET" && url.pathname === "/api/corpus") {
      const documents = loadSourceDocuments();
      return json(res, 200, {
        documents: documents.map((document) => ({
          sourceId: document.sourceId,
          versionId: document.versionId,
          title: document.title,
          sourceType: document.sourceType,
          domain: document.domain,
          audience: document.audience,
          approval: document.approval,
          policySensitivity: document.policySensitivity,
          authorityTier: document.authorityTier,
          effectiveFrom: document.effectiveFrom,
          effectiveTo: document.effectiveTo ?? null,
          eligibility: document.eligibility,
          deliveryFileId: document.deliveryFileId,
          originalFormat: document.originalFormat,
          extractionMode: document.extractionMode,
          ocrReviewed: document.ocrReviewed,
          faqCategory: document.faqCategory ?? null,
          faqRows: document.faqRows ?? null,
          contentBytes: Buffer.byteLength(document.content, "utf8"),
        })),
        totals: {
          documents: documents.length,
          deliveries: new Set(documents.map((document) => document.deliveryFileId)).size,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/profiles") {
      const payload = JSON.parse(readFileSync(join(ROOT, "case-data", "actors", "profiles.json"), "utf8"));
      return json(res, 200, payload);
    }

    const governedSourceMatch = req.method === "GET"
      ? url.pathname.match(/^\/api\/sources\/([^/]+)\/([^/]+)$/u)
      : null;
    if (governedSourceMatch) {
      const sourceId = decodeURIComponent(governedSourceMatch[1]);
      const versionId = decodeURIComponent(governedSourceMatch[2]);
      const result = getGovernedSource(sourceId, versionId, {
        profileId: url.searchParams.get("profileId") ?? undefined,
        legalEntityId: url.searchParams.get("legalEntityId") ?? undefined,
        baseId: url.searchParams.get("baseId") ?? undefined,
        relationship: url.searchParams.get("relationship") ?? undefined,
        role: url.searchParams.get("role") ?? undefined,
        asOf: url.searchParams.get("asOf") ?? "",
      });
      return result
        ? json(res, 200, result)
        : json(res, 404, { error: "source_not_found" });
    }

    if (req.method === "POST" && url.pathname === "/v1/decide") {
      const state = runtimeSnapshot();
      if (state.status !== "ready_learned" && state.status !== "ready_degraded") {
        return json(res, 503, {
          error: state.status === "failed" ? "runtime_unavailable" : "runtime_initializing",
          status: state.status,
        });
      }
      const parsed = parseDecideRequest(await readJson(req));
      if (!parsed.ok) return json(res, 400, { error: "invalid_request", details: parsed.errors });

      const decision = await decide(parsed.value);
      const contractErrors = validateDecision(decision);
      if (contractErrors.length) {
        return json(res, 500, { error: "invalid_decision_contract", details: contractErrors });
      }
      loggedDecisionKind = decision.kind;
      loggedReasonCode = decision.kind === "defer" ? decision.handoff.reasonCode : "none";
      recordDecision(decision);
      return json(res, 200, decision);
    }

    const handoffMatch = url.pathname.match(/^\/v1\/handoffs\/([^/]+)$/);
    if (req.method === "GET" && handoffMatch) {
      const handoff = getHandoff(decodeURIComponent(handoffMatch[1]));
      return handoff ? json(res, 200, handoff) : json(res, 404, { error: "handoff_not_found" });
    }

    const resolutionMatch = url.pathname.match(/^\/v1\/handoffs\/([^/]+)\/resolve$/);
    if (req.method === "POST" && resolutionMatch) {
      const body = await readJson(req);
      const actorId = body && typeof body === "object" && !Array.isArray(body) && "actorId" in body
        ? String(body.actorId).trim()
        : "";
      const summary = body && typeof body === "object" && !Array.isArray(body) && "summary" in body
        ? String(body.summary).trim()
        : "";
      if (!actorId || actorId.length > 200 || !summary || summary.length > 4_000) {
        return json(res, 400, { error: "invalid_resolution", details: ["actorId and summary are required and bounded"] });
      }
      const handoff = resolveHandoff(decodeURIComponent(resolutionMatch[1]), actorId, summary);
      return handoff ? json(res, 200, handoff) : json(res, 404, { error: "handoff_not_found" });
    }

    const traceMatch = req.method === "GET" ? url.pathname.match(/^\/v1\/traces\/([^/]+)$/) : null;
    if (traceMatch) {
      const trace = getTrace(decodeURIComponent(traceMatch[1]));
      return trace ? json(res, 200, trace) : json(res, 404, { error: "trace_not_found" });
    }

    return json(res, 404, {
      error: "not_found",
      paths: ["/", "/sources", "/sources/:sourceId/:versionId", "/healthz", "/readyz", "/api/corpus", "/api/profiles", "/api/sources/:sourceId/:versionId", "POST /v1/decide", "/v1/traces/:traceId", "/v1/handoffs/:ticketId", "POST /v1/handoffs/:ticketId/resolve"],
    });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return json(res, 409, { error: "idempotency_conflict", message: error.message });
    }
    const message = error instanceof Error ? error.message : "unexpected error";
    const status = message.includes("request body") ? 400 : 500;
    return json(res, status, status === 400
      ? { error: "invalid_request", message }
      : { error: "internal_error", message: "The service could not complete the request." });
  }
});

server.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({
    level: "info",
    event: "server_listening",
    address: `http://0.0.0.0:${PORT}`,
  }));
  void startRuntimeInitialization().then((state) => {
    console.log(JSON.stringify({
      level: state.status === "failed" ? "error" : "info",
      event: "runtime_initialized",
      ...state,
      error: state.status === "failed" ? "runtime_initialization_failed" : undefined,
    }));
  });
});
