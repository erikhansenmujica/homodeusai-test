import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSourceDocuments } from "../src/corpus.ts";
import { learnedSemanticIndex } from "../src/learned-semantic.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = resolve(process.env.SEMANTIC_ARTIFACT_PATH?.trim() || `${root}/artifacts`);

process.env.RUNTIME_STATE_PATH = artifactDirectory;
mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });

const documents = loadSourceDocuments();
const results = await learnedSemanticIndex(documents).search("políticas e processos de People Operations", 1);
if (results.length === 0) throw new Error("semantic index warm-up returned no candidates");

console.log(`Built learned semantic index for ${documents.length} documents at ${artifactDirectory}`);
