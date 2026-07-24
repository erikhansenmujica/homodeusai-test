import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") return reject(new Error("could not allocate port"));
      socket.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHttp(
  url: string,
  predicate: (response: Response) => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (await predicate(response)) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error ? lastError : new Error(`timed out waiting for ${url}`);
}

async function startServer(
  statePath: string,
  environment: Record<string, string> = {},
): Promise<{ child: ChildProcess; baseUrl: string; logs: string[] }> {
  const port = await freePort();
  const logs: string[] = [];
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      RUNTIME_STATE_PATH: statePath,
      LEARNED_SEMANTIC_ENABLED: "false",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttp(`${baseUrl}/healthz`, (response) => response.status === 200);
  return { child, baseUrl, logs };
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

const requester = {
  subjectId: "runtime-test",
  legalEntityId: "NA_SERVICOS",
  baseId: "SUDESTE",
  relationship: "employee",
  role: "colaborador",
  domains: [],
};

test("readiness, security, metrics, and idempotency conflicts are operationally truthful", async () => {
  const statePath = mkdtempSync(join(tmpdir(), "nexo-runtime-test-"));
  const service = await startServer(statePath);
  try {
    const ready = await waitForHttp(`${service.baseUrl}/readyz`, (response) => response.status === 200);
    const readiness = await ready.json() as Record<string, unknown>;
    assert.equal(readiness.status, "ready_degraded");
    assert.equal(readiness.retrievalMode, "degraded");
    assert.equal(readiness.documents, 34);
    assert.ok(Number(readiness.passages) > 0);
    assert.ok(Number(readiness.initializationMs) >= 0);

    const page = await fetch(service.baseUrl);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");

    const firstPayload = {
      requestId: "same-runtime-request",
      question: "Quero falar com uma pessoa.",
      asOf: "2026-07-24T12:00:00.000Z",
      requester,
      history: [],
    };
    const first = await fetch(`${service.baseUrl}/v1/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(firstPayload),
    });
    assert.equal(first.status, 200);
    const conflict = await fetch(`${service.baseUrl}/v1/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...firstPayload, question: "Preciso de atendimento humano agora." }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json() as { error?: string }).error, "idempotency_conflict");

    const metrics = await fetch(`${service.baseUrl}/metrics`).then((response) => response.text());
    assert.match(metrics, /nexo_runtime_ready\{status="ready_degraded",retrieval_mode="degraded"\} 1/u);
    assert.doesNotMatch(metrics, /Quero falar|atendimento humano/u);
    assert.ok(service.logs.join("").includes('"route":"decide"'));
    assert.doesNotMatch(service.logs.join(""), /Quero falar|atendimento humano/u);
  } finally {
    await stopServer(service.child);
    rmSync(statePath, { recursive: true, force: true });
  }
});

test("missing or corrupt learned models enter the fully initialized deterministic mode", async () => {
  for (const condition of ["missing", "corrupt"] as const) {
    const statePath = mkdtempSync(join(tmpdir(), `nexo-model-${condition}-`));
    const modelPath = join(statePath, `${condition}-model`);
    if (condition === "corrupt") {
      mkdirSync(join(modelPath, "onnx"), { recursive: true });
      writeFileSync(join(modelPath, "onnx", "model_int8.onnx"), "not-an-onnx-model", "utf8");
    }
    const service = await startServer(statePath, {
      LEARNED_SEMANTIC_ENABLED: "true",
      LEARNED_SEMANTIC_MODEL_PATH: modelPath,
    });
    try {
      const ready = await waitForHttp(`${service.baseUrl}/readyz`, (response) => response.status === 200);
      const payload = await ready.json() as { status?: string; retrievalMode?: string };
      assert.equal(payload.status, "ready_degraded");
      assert.equal(payload.retrievalMode, "degraded");
    } finally {
      await stopServer(service.child);
      rmSync(statePath, { recursive: true, force: true });
    }
  }
});

test("corrupt durable handoff or trace state fails readiness", async () => {
  for (const corrupt of ["handoff", "trace"] as const) {
    const statePath = mkdtempSync(join(tmpdir(), `nexo-corrupt-${corrupt}-`));
    if (corrupt === "handoff") {
      writeFileSync(join(statePath, "handoffs.json"), "{not-json", "utf8");
    } else {
      const traces = join(statePath, "traces");
      mkdirSync(traces);
      writeFileSync(join(traces, "trace-corrupt00.json"), "{not-json", "utf8");
    }
    const service = await startServer(statePath);
    try {
      const failed = await waitForHttp(`${service.baseUrl}/readyz`, async (response) => {
        if (response.status !== 503) return false;
        const payload = await response.clone().json() as { status?: string };
        return payload.status === "failed";
      });
      const payload = await failed.json() as { status?: string; error?: string };
      assert.equal(payload.status, "failed");
      assert.equal(payload.error, "runtime_initialization_failed");
    } finally {
      await stopServer(service.child);
      rmSync(statePath, { recursive: true, force: true });
    }
  }
});

test("trace retention is bounded and preserves traces referenced by open handoffs", () => {
  const statePath = mkdtempSync(join(tmpdir(), "nexo-retention-test-"));
  try {
    const script = `
      import assert from "node:assert/strict";
      import { existsSync, readdirSync } from "node:fs";
      import { join } from "node:path";
      import { createHandoff } from "./src/queue.ts";
      import { saveTrace } from "./src/traces.ts";
      const request = {
        requestId: "retention-active",
        question: "Quero falar com uma pessoa.",
        asOf: "2026-07-24T12:00:00.000Z",
        requester: {
          subjectId: "retention",
          legalEntityId: "NA_SERVICOS",
          baseId: "SUDESTE",
          relationship: "employee",
          role: "colaborador",
          domains: []
        },
        history: []
      };
      const trace = (traceId, requestId) => ({
        traceId,
        requestId,
        createdAt: new Date().toISOString(),
        decisionKind: "defer",
        pipelineVersion: "test",
        indexVersion: "test",
        stages: ["retrieval", "governance", "decision"],
        governance: { candidateCount: 0, eligibleCount: 0, rejectedCount: 0, eligibleSources: [], rejectionReasons: {} },
        route: { kind: "defer", reasonCode: "human_requested" },
        provider: { status: "degraded" },
        consideredEvidence: [],
        notes: []
      });
      const activeTraceId = "trace-retention-active";
      saveTrace(trace(activeTraceId, request.requestId));
      createHandoff(request, "human_requested", activeTraceId);
      for (let index = 0; index < 504; index += 1) {
        const suffix = String(index).padStart(8, "0");
        saveTrace(trace("trace-retention-" + suffix, "request-" + suffix));
      }
      const directory = join(process.env.RUNTIME_STATE_PATH, "traces");
      assert.equal(readdirSync(directory).filter((name) => name.endsWith(".json")).length, 500);
      assert.equal(existsSync(join(directory, activeTraceId + ".json")), true);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, RUNTIME_STATE_PATH: statePath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readdirSync(join(statePath, "traces")).filter((name) => name.endsWith(".json")).length, 500);
  } finally {
    rmSync(statePath, { recursive: true, force: true });
  }
});
