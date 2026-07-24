import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "./submission-lib.ts";

interface ModeResult {
  requestedMode: "learned" | "degraded";
  observedMode: string;
  startupMs: number;
  firstDecisionMs: number;
  cases: number;
  passed: number;
  safe: boolean;
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") return reject(new Error("could not allocate eval port"));
      listener.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitForReady(baseUrl: string, timeoutMs = 180_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      const payload = await response.json() as Record<string, unknown>;
      if (response.ok) return payload;
      if (payload.status === "failed") throw new Error("runtime initialization failed");
    } catch (error) {
      if (error instanceof Error && error.message === "runtime initialization failed") throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("runtime did not become ready within 180 seconds");
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolveExit) => {
    child.once("exit", () => resolveExit());
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveExit();
    }, 3_000).unref();
  });
}

async function runEval(baseUrl: string, reportPath: string): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(process.execPath, ["evals/run.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        CANDIDATE_BASE_URL: baseUrl,
        CANDIDATE_EVAL_REPORT_PATH: reportPath,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : reject(new Error(`candidate eval exited with status ${code}`)));
  });
}

async function exerciseMode(requestedMode: "learned" | "degraded"): Promise<ModeResult> {
  const port = await freePort();
  const statePath = mkdtempSync(join(tmpdir(), `nexo-eval-${requestedMode}-`));
  const reportPath = join(tmpdir(), `nexo-eval-${requestedMode}-${process.pid}.json`);
  const baseUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];
  const startupStarted = performance.now();
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      RUNTIME_STATE_PATH: statePath,
      LEARNED_SEMANTIC_ENABLED: requestedMode === "learned" ? "true" : "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => output.push(String(chunk)));
  child.stderr?.on("data", (chunk) => output.push(String(chunk)));
  try {
    const readiness = await waitForReady(baseUrl);
    const startupMs = performance.now() - startupStarted;
    const decisionStarted = performance.now();
    const decisionResponse = await fetch(`${baseUrl}/v1/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: `matrix-first-${requestedMode}-${process.pid}`,
        question: "Com quanta antecedência devo solicitar férias?",
        asOf: "2026-07-24T12:00:00.000Z",
        requester: {
          subjectId: "matrix-subject",
          legalEntityId: "NA_SERVICOS",
          baseId: "SUDESTE",
          relationship: "employee",
          role: "colaborador",
          domains: [],
        },
        history: [],
      }),
    });
    const firstDecisionMs = performance.now() - decisionStarted;
    if (!decisionResponse.ok) throw new Error(`first decision failed with HTTP ${decisionResponse.status}`);
    await runEval(baseUrl, reportPath);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      totals: { cases: number; passed: number };
      passed: boolean;
      safe: boolean;
    };
    return {
      requestedMode,
      observedMode: String(readiness.retrievalMode ?? "unknown"),
      startupMs: Number(startupMs.toFixed(3)),
      firstDecisionMs: Number(firstDecisionMs.toFixed(3)),
      cases: report.totals.cases,
      passed: report.totals.passed,
      safe: report.safe,
    };
  } catch (error) {
    throw new Error(`${requestedMode} matrix failed: ${error instanceof Error ? error.message : error}\n${output.join("").slice(-4_000)}`);
  } finally {
    await stop(child);
    rmSync(statePath, { recursive: true, force: true });
    rmSync(reportPath, { force: true });
  }
}

const results: ModeResult[] = [];
for (const mode of ["degraded", "learned"] as const) results.push(await exerciseMode(mode));
const deterministic = results.find((result) => result.requestedMode === "degraded")!;
const learned = results.find((result) => result.requestedMode === "learned")!;
const learnedImprovesCoverage = learned.observedMode === "learned"
  && learned.passed > deterministic.passed
  && learned.safe;
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  results,
  learnedImprovesCoverage,
  recommendedDefault: learnedImprovesCoverage ? "learned" : "degraded",
  gates: {
    requestedModesObserved: results.every((result) => result.observedMode === result.requestedMode),
    allCasesSafe: results.every((result) => result.safe),
    startupUnder180Seconds: results.every((result) => result.startupMs < 180_000),
    firstDecisionUnder10Seconds: results.every((result) => result.firstDecisionMs < 10_000),
  },
};
const outputPath = resolve(process.env.EVAL_MATRIX_REPORT_PATH ?? join(ROOT, "evals", "matrix-report.json"));
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...report }, null, 2));
if (!Object.values(report.gates).every(Boolean)) process.exitCode = 1;
