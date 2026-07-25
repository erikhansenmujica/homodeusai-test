import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  E5_MODEL_FILES,
  E5_MODEL_ID,
  E5_MODEL_REVISION,
} from "../src/model-manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = [
  { id: E5_MODEL_ID, revision: E5_MODEL_REVISION, files: E5_MODEL_FILES },
] as const;
// Bound transient network recovery so CI remains deterministic and eventually fails closed.
const DOWNLOAD_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;

function sha256(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function targetFor(modelId: string, file: string): string { return join(ROOT, "models", ...modelId.split("/"), file); }
// Pause only between failed attempts instead of extending successful setup.
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}
// Honor server backoff guidance when available while keeping the delay bounded.
function retryAfterDelay(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return undefined;
  return Math.max(0, retryAt - Date.now());
}
// Retry checksum-pinned model downloads after transient transport or server failures.
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  let attemptsMade = 0;
  let serverDelay: number | undefined;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    attemptsMade = attempt;
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
      serverDelay = retryAfterDelay(response);
      if (response.status >= 400 && response.status < 500
        && response.status !== 408 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
      serverDelay = undefined;
    }
    if (attempt < DOWNLOAD_ATTEMPTS) {
      // Exponential recovery absorbs short rate-limit windows without unbounded CI hangs.
      const exponentialDelay = RETRY_DELAY_MS * (2 ** (attempt - 1));
      await wait(Math.min(MAX_RETRY_DELAY_MS, Math.max(exponentialDelay, serverDelay ?? 0)));
    }
  }
  throw new Error(`Could not download ${url} after ${attemptsMade} attempts`, {
    cause: lastError,
  });
}
function verify(): void {
  for (const model of MODELS) {
    const missing = Object.keys(model.files).filter((file) => !existsSync(targetFor(model.id, file)));
    if (missing.length) {
      throw new Error(`Missing local ${model.id} assets: ${missing.join(", ")}. Run npm run setup:model during build setup.`);
    }
    const mismatched = Object.entries(model.files)
      .filter(([file, expected]) => sha256(targetFor(model.id, file)) !== expected)
      .map(([file]) => file);
    if (mismatched.length) {
      throw new Error(`Checksum mismatch for ${model.id}: ${mismatched.join(", ")}. Remove that local model and rerun npm run setup:model.`);
    }
  }
}

async function materialize(): Promise<void> {
  for (const model of MODELS) {
    for (const [file, expected] of Object.entries(model.files)) {
      const output = targetFor(model.id, file);
      if (existsSync(output) && sha256(output) === expected) continue;
      mkdirSync(dirname(output), { recursive: true });
      const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`;
      // Use bounded retry because hosted CI occasionally times out before the first byte.
      const response = await fetchWithRetry(url);
      const temporary = `${output}.download`;
      try {
        writeFileSync(temporary, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
        if (sha256(temporary) !== expected) throw new Error(`Checksum mismatch while downloading ${model.id}/${file}`);
        renameSync(temporary, output);
      } finally {
        if (existsSync(temporary)) rmSync(temporary, { force: true });
      }
    }
  }
  verify();
  console.log(`Materialized ${MODELS.map((model) => `${model.id}@${model.revision}`).join(", ")}`);
}

if (process.argv.includes("--verify")) {
  verify();
  console.log(`Verified ${MODELS.map((model) => `${model.id}@${model.revision}`).join(", ")}`);
} else {
  await materialize();
}
