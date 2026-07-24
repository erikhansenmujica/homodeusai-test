import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "Xenova/multilingual-e5-small";
const REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const TARGET = join(ROOT, "models", "Xenova", "multilingual-e5-small");
const MODEL_FILE = "onnx/model_int8.onnx";
const MODEL_SHA256 = "4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c";
const FILES = ["config.json", "quant_config.json", "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", MODEL_FILE];

function sha256(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function targetFor(file: string): string { return join(TARGET, file); }

function verify(): void {
  const missing = FILES.filter((file) => !existsSync(targetFor(file)));
  if (missing.length) throw new Error(`Missing local ${MODEL} assets: ${missing.join(", ")}. Run npm run setup:model during build setup.`);
  if (sha256(targetFor(MODEL_FILE)) !== MODEL_SHA256) throw new Error(`Checksum mismatch for ${MODEL_FILE}; remove models/Xenova/multilingual-e5-small and rerun npm run setup:model.`);
}

async function materialize(): Promise<void> {
  for (const file of FILES) {
    const output = targetFor(file);
    if (existsSync(output)) continue;
    mkdirSync(dirname(output), { recursive: true });
    const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download ${file}: HTTP ${response.status}`);
    const temporary = `${output}.download`;
    writeFileSync(temporary, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    renameSync(temporary, output);
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
