import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDecideRequest, validateDecision } from "./contract.ts";
import { loadSourceDocuments } from "./corpus.ts";
import { decide } from "./decide.ts";
import { getHandoff, resolveHandoff } from "./queue.ts";
import { lexicalIndex } from "./retrieval.ts";
import { getTrace } from "./traces.ts";
import { renderWorkbench } from "./ui.ts";

const PORT = Number(process.env.PORT) || 8080;
const MAX_BODY_BYTES = 256 * 1024;
const startedAt = Date.now();
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_ARCHIVE_PATH = process.env.CANDIDATE_ARCHIVE_PATH?.trim() || join(ROOT, "dist", "nexo-atlantico-knowledge-case.tgz");

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
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
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      return json(res, 200, { status: "ok", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      const documents = loadSourceDocuments();
      const index = lexicalIndex(documents);
      return json(res, 200, { status: "ready", documents: documents.length, passages: index.passages.length });
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
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
        "x-content-type-options": "nosniff",
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
        "x-content-type-options": "nosniff",
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

    if (req.method === "POST" && url.pathname === "/v1/decide") {
      const parsed = parseDecideRequest(await readJson(req));
      if (!parsed.ok) return json(res, 400, { error: "invalid_request", details: parsed.errors });

      const decision = await decide(parsed.value);
      const contractErrors = validateDecision(decision);
      if (contractErrors.length) {
        return json(res, 500, { error: "invalid_decision_contract", details: contractErrors });
      }
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
      paths: ["/", "/healthz", "/readyz", "/api/corpus", "/api/profiles", "POST /v1/decide", "/v1/traces/:traceId", "/v1/handoffs/:ticketId", "POST /v1/handoffs/:ticketId/resolve"],
    });
  } catch (error) {
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
  console.log(`Nexo knowledge case listening on http://0.0.0.0:${PORT}`);
});
