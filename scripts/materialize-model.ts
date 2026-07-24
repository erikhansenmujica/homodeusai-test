import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { E5_MODEL_FILES, E5_MODEL_ID, E5_MODEL_REVISION } from "../src/model-manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = E5_MODEL_ID;
const REVISION = E5_MODEL_REVISION;
const TARGET = join(ROOT, "models", "Xenova", "multilingual-e5-small");
const FILES = E5_MODEL_FILES;

function sha256(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function targetFor(file: string): string { return join(TARGET, file); }

function verify(): void {
  const missing = Object.keys(FILES).filter((file) => !existsSync(targetFor(file)));
  if (missing.length) throw new Error(`Missing local ${MODEL} assets: ${missing.join(", ")}. Run npm run setup:model during build setup.`);
  const mismatched = Object.entries(FILES)
    .filter(([file, expected]) => sha256(targetFor(file)) !== expected)
    .map(([file]) => file);
  if (mismatched.length) {
    throw new Error(`Checksum mismatch for ${mismatched.join(", ")}; remove models/Xenova/multilingual-e5-small and rerun npm run setup:model.`);
  }
}

async function materialize(): Promise<void> {
  for (const file of Object.keys(FILES)) {
    const output = targetFor(file);
    if (existsSync(output) && sha256(output) === FILES[file as keyof typeof FILES]) continue;
    mkdirSync(dirname(output), { recursive: true });
    const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download ${file}: HTTP ${response.status}`);
    const temporary = `${output}.download`;
    try {
      writeFileSync(temporary, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
      const expected = FILES[file as keyof typeof FILES];
      if (sha256(temporary) !== expected) throw new Error(`Checksum mismatch while downloading ${file}`);
      renameSync(temporary, output);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  }
  verify();
  console.log(`Materialized ${MODEL}@${REVISION} at ${TARGET}`);
}

if (process.argv.includes("--verify")) {
  verify();
  console.log(`Verified ${MODEL}@${REVISION} at ${TARGET}`);
} else {
  await materialize();
}
