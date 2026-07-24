import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPassages } from "./retrieval.ts";
import type { Passage, SourceDocument } from "./types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ID = "Xenova/multilingual-e5-small";
const MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const MODEL_PATH = join(ROOT, "models", "Xenova", "multilingual-e5-small");
const INDEX_SCHEMA = 2;

type Extractor = (inputs: string[], options: Record<string, unknown>) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

export interface LearnedCandidate { document: SourceDocument; passage: Passage; score: number; }
interface StoredEntry { passageId: string; passageHash: string; vector: number[]; }
interface StoredIndex { schemaVersion: number; modelId: string; revision: string; dimensions: number; entries: StoredEntry[]; }

function normalise(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) throw new Error("embedding output was empty");
  return vector.map((value) => value / magnitude);
}
function cosine(left: number[], right: number[]): number { return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0); }
function passageHash(document: SourceDocument, passage: Passage): string {
  return createHash("sha256").update(`${document.title}\n${passage.heading}\n${passage.text}`, "utf8").digest("hex");
}

export class TransformersLocalE5EmbeddingProvider {
  readonly id = "transformers-local-e5";
  readonly modelPath = MODEL_PATH;
  private extractorPromise: Promise<Extractor> | undefined;

  async isAvailable(): Promise<boolean> { return existsSync(join(MODEL_PATH, "onnx", "model_int8.onnx")); }
  async extractor(): Promise<Extractor> {
    if (!this.extractorPromise) this.extractorPromise = (async () => {
      if (!await this.isAvailable()) throw new Error(`local E5 model is missing at ${MODEL_PATH}`);
      const { env, pipeline } = await import("@huggingface/transformers");
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = `${resolve(ROOT, "models")}/`;
      return await pipeline("feature-extraction", MODEL_ID, { dtype: "int8", revision: MODEL_REVISION }) as unknown as Extractor;
    })();
    return this.extractorPromise;
  }
  async embed(inputs: string[], prefix: "query: " | "passage: "): Promise<number[][]> {
    if (!inputs.length) return [];
    const extractor = await this.extractor();
    const output = await extractor(inputs.map((item) => `${prefix}${item.slice(0, 8_000)}`), { pooling: "mean", normalize: true });
    const dimensions = output.dims.at(-1);
    if (!dimensions || dimensions < 64) throw new Error("unexpected E5 embedding dimensions");
    const values = Array.from(output.data);
    if (values.length !== inputs.length * dimensions) throw new Error("invalid E5 embedding batch shape");
    return inputs.map((_, index) => normalise(values.slice(index * dimensions, (index + 1) * dimensions)));
  }
  embedQuery(query: string): Promise<number[][]> { return this.embed([query], "query: "); }
  embedPassages(passages: string[]): Promise<number[][]> { return this.embed(passages, "passage: "); }
}

export class LearnedSemanticIndex {
  readonly provider = new TransformersLocalE5EmbeddingProvider();
  private entries: Array<{ document: SourceDocument; passage: Passage; vector: number[] }> = [];
  private readyPromise: Promise<void> | undefined;
  readonly documents: SourceDocument[];
  constructor(documents: SourceDocument[]) { this.documents = documents; }
  async ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.build();
    return this.readyPromise;
  }
  private async build(): Promise<void> {
    const path = process.env.RUNTIME_STATE_PATH ? join(process.env.RUNTIME_STATE_PATH, "learned-semantic-index.json") : join(ROOT, ".runtime", "learned-semantic-index.json");
    let prior: StoredIndex | undefined;
    try { prior = JSON.parse(readFileSync(path, "utf8")) as StoredIndex; } catch { prior = undefined; }
    const reusable = new Map((prior?.schemaVersion === INDEX_SCHEMA && prior.modelId === MODEL_ID && prior.revision === MODEL_REVISION ? prior.entries : []).map((entry) => [entry.passageId, entry]));
    const passages = this.documents.flatMap((document) => extractPassages(document).map((passage) => ({ document, passage, hash: passageHash(document, passage) })));
    const missing = passages.filter((entry) => reusable.get(entry.passage.id)?.passageHash !== entry.hash);
    const vectors = new Map<string, number[]>();
    for (const entry of passages) { const cached = reusable.get(entry.passage.id); if (cached?.passageHash === entry.hash) vectors.set(entry.passage.id, cached.vector); }
    for (let index = 0; index < missing.length; index += 16) {
      const batch = missing.slice(index, index + 16);
      const embedded = await this.provider.embedPassages(batch.map((entry) =>
        `${entry.document.title}\n${entry.passage.heading}\n${entry.passage.text}`));
      batch.forEach((entry, position) => vectors.set(entry.passage.id, embedded[position]!));
    }
    this.entries = passages.map(({ document, passage }) => ({ document, passage, vector: vectors.get(passage.id)! }));
    const payload: StoredIndex = { schemaVersion: INDEX_SCHEMA, modelId: MODEL_ID, revision: MODEL_REVISION, dimensions: this.entries[0]?.vector.length ?? 0,
      entries: passages.map(({ passage, hash }) => ({ passageId: passage.id, passageHash: hash, vector: vectors.get(passage.id)! })) };
    try { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600 }); renameSync(temporary, path); } catch { /* optional cache only */ }
  }
  async search(query: string, limit = 28): Promise<LearnedCandidate[]> {
    await this.ready();
    const [vector] = await this.provider.embedQuery(query);
    return this.entries.map((entry) => ({ document: entry.document, passage: entry.passage, score: cosine(vector!, entry.vector) }))
      .sort((left, right) => right.score - left.score || left.passage.id.localeCompare(right.passage.id)).slice(0, limit);
  }
}

let cached: { documents: SourceDocument[]; index: LearnedSemanticIndex } | undefined;
export function learnedSemanticIndex(documents: SourceDocument[]): LearnedSemanticIndex {
  if (cached?.documents === documents) return cached.index;
  cached = { documents, index: new LearnedSemanticIndex(documents) };
  return cached.index;
}
