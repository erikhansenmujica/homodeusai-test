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

function sha256(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function targetFor(modelId: string, file: string): string { return join(ROOT, "models", ...modelId.split("/"), file); }
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
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not download ${model.id}/${file}: HTTP ${response.status}`);
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
