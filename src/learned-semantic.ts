import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractPassages } from "./retrieval.ts";
import { E5_MODEL_FILES, E5_MODEL_ID, E5_MODEL_REVISION } from "./model-manifest.ts";
import type { Passage, SourceDocument } from "./types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ID = E5_MODEL_ID;
const MODEL_REVISION = E5_MODEL_REVISION;
const MODEL_PATH = resolve(
  process.env.LEARNED_SEMANTIC_MODEL_PATH?.trim()
    || join(ROOT, "models", ...MODEL_ID.split("/")),
);
const INDEX_SCHEMA = 3;

type Extractor = (inputs: string[], options: Record<string, unknown>) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

export interface LearnedCandidate { document: SourceDocument; passage: Passage; score: number; }
interface StoredEntry {
  passageId: string;
  passageHash: string;
  answerHash: string;
  vector: number[];
  answerVector: number[];
}
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
function answerHash(passage: Passage): string {
  return createHash("sha256").update(passage.answerText, "utf8").digest("hex");
}

export class TransformersLocalE5EmbeddingProvider {
  readonly id = "transformers-local-e5";
  readonly modelPath = MODEL_PATH;
  private extractorPromise: Promise<Extractor> | undefined;

  async isAvailable(): Promise<boolean> {
    return Object.entries(E5_MODEL_FILES).every(([file, expected]) => {
      const path = join(MODEL_PATH, file);
      return existsSync(path) && createHash("sha256").update(readFileSync(path)).digest("hex") === expected;
    });
  }
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
  embedQueries(queries: string[]): Promise<number[][]> { return this.embed(queries, "query: "); }
  embedQuery(query: string): Promise<number[][]> { return this.embed([query], "query: "); }
  embedPassages(passages: string[]): Promise<number[][]> { return this.embed(passages, "passage: "); }
}

export class LearnedSemanticIndex {
  readonly provider = new TransformersLocalE5EmbeddingProvider();
  private entries: Array<{
    document: SourceDocument;
    passage: Passage;
    vector: number[];
    answerVector: number[];
  }> = [];
  private readonly queryVectors = new Map<string, number[]>();
  private readyPromise: Promise<void> | undefined;
  readonly documents: SourceDocument[];
  constructor(documents: SourceDocument[]) { this.documents = documents; }
  async ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.build();
    return this.readyPromise;
  }
  private async build(): Promise<void> {
    const path = process.env.RUNTIME_STATE_PATH
      ? join(process.env.RUNTIME_STATE_PATH, "learned-semantic-index.json")
      : join(ROOT, ".runtime", "learned-semantic-index.json");
    const bundledPath = process.env.BUNDLED_SEMANTIC_INDEX_PATH?.trim()
      || join(ROOT, "artifacts", "learned-semantic-index.json");
    let prior: StoredIndex | undefined;
    for (const candidate of [path, bundledPath]) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as StoredIndex;
        if (
          parsed.schemaVersion === INDEX_SCHEMA
          && parsed.modelId === MODEL_ID
          && parsed.revision === MODEL_REVISION
        ) {
          prior = parsed;
          break;
        }
      } catch {
        prior = undefined;
      }
    }
    const reusable = new Map((prior?.entries ?? []).map((entry) => [entry.passageId, entry]));
    const passages = this.documents.flatMap((document) => extractPassages(document).map((passage) => ({
      document,
      passage,
      hash: passageHash(document, passage),
      answerHash: answerHash(passage),
    })));
    const missing = passages.filter((entry) => reusable.get(entry.passage.id)?.passageHash !== entry.hash);
    const missingAnswers = passages.filter((entry) => {
      const cached = reusable.get(entry.passage.id);
      return cached?.answerHash !== entry.answerHash || !Array.isArray(cached.answerVector);
    });
    const vectors = new Map<string, number[]>();
    const answerVectors = new Map<string, number[]>();
    for (const entry of passages) {
      const cached = reusable.get(entry.passage.id);
      if (cached?.passageHash === entry.hash) vectors.set(entry.passage.id, cached.vector);
      if (cached?.answerHash === entry.answerHash && Array.isArray(cached.answerVector)) {
        answerVectors.set(entry.passage.id, cached.answerVector);
      }
    }
    for (let index = 0; index < missing.length; index += 16) {
      const batch = missing.slice(index, index + 16);
      const embedded = await this.provider.embedPassages(batch.map((entry) =>
        `${entry.document.title}\n${entry.passage.heading}\n${entry.passage.text}`));
      batch.forEach((entry, position) => vectors.set(entry.passage.id, embedded[position]!));
    }
    for (let index = 0; index < missingAnswers.length; index += 16) {
      const batch = missingAnswers.slice(index, index + 16);
      const embedded = await this.provider.embedPassages(batch.map((entry) => entry.passage.answerText));
      batch.forEach((entry, position) => answerVectors.set(entry.passage.id, embedded[position]!));
    }
    this.entries = passages.map(({ document, passage }) => ({
      document,
      passage,
      vector: vectors.get(passage.id)!,
      answerVector: answerVectors.get(passage.id)!,
    }));
    const payload: StoredIndex = { schemaVersion: INDEX_SCHEMA, modelId: MODEL_ID, revision: MODEL_REVISION, dimensions: this.entries[0]?.vector.length ?? 0,
      entries: passages.map(({ passage, hash, answerHash: storedAnswerHash }) => ({
        passageId: passage.id,
        passageHash: hash,
        answerHash: storedAnswerHash,
        vector: vectors.get(passage.id)!,
        answerVector: answerVectors.get(passage.id)!,
      })) };
    try { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp`; writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600 }); renameSync(temporary, path); } catch { /* optional cache only */ }
  }
  async search(query: string, limit = 28): Promise<LearnedCandidate[]> {
    await this.ready();
    return (await this.searchMany([query], limit))[0]!;
  }
  async searchMany(queries: string[], limit = 28): Promise<LearnedCandidate[][]> {
    await this.ready();
    const vectors = await this.provider.embedQueries(queries);
    queries.forEach((query, index) => {
      this.queryVectors.delete(query);
      this.queryVectors.set(query, vectors[index]!);
      if (this.queryVectors.size > 64) this.queryVectors.delete(this.queryVectors.keys().next().value!);
    });
    return vectors.map((vector) =>
      this.entries.map((entry) => ({
        document: entry.document,
        passage: entry.passage,
        score: cosine(vector, entry.vector),
      })).sort((left, right) =>
        right.score - left.score || left.passage.id.localeCompare(right.passage.id)).slice(0, limit));
  }

  async answerAlignments(question: string, passages: Passage[]): Promise<number[]> {
    await this.ready();
    let query = this.queryVectors.get(question);
    if (!query) {
      [query] = await this.provider.embedQueries([question]);
      this.queryVectors.set(question, query!);
    }
    const byPassage = new Map(this.entries.map((entry) => [entry.passage.id, entry.answerVector]));
    return passages.map((passage) => cosine(query!, byPassage.get(passage.id) ?? []));
  }

  async answerEmbeddings(passages: Passage[]): Promise<number[][]> {
    await this.ready();
    const byPassage = new Map(this.entries.map((entry) => [entry.passage.id, entry.answerVector]));
    return passages.map((passage) => byPassage.get(passage.id) ?? []);
  }
}

let cached: { documents: SourceDocument[]; index: LearnedSemanticIndex } | undefined;
export function learnedSemanticIndex(documents: SourceDocument[]): LearnedSemanticIndex {
  if (cached?.documents === documents) return cached.index;
  cached = { documents, index: new LearnedSemanticIndex(documents) };
  return cached.index;
}
