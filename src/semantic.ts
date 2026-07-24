import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractPassages, queryExpansion, tokenize } from "./retrieval.ts";
import type { Passage, RetrievalCandidate, SourceDocument } from "./types.ts";

const DIMENSIONS = 256;
const MODEL_ID = "local-hashed-subword-v1";

export interface SemanticRetrievalCandidate {
  document: SourceDocument;
  passage: Passage;
  score: number;
}

function hash(value: string): number {
  return createHash("sha256").update(value, "utf8").digest().readUInt32BE(0);
}

function embedding(text: string): number[] {
  const vector = Array.from({ length: DIMENSIONS }, () => 0);
  for (const token of tokenize(text)) {
    const padded = `^${token}$`;
    for (let index = 0; index <= padded.length - 3; index += 1) {
      const value = hash(padded.slice(index, index + 3));
      vector[value % DIMENSIONS] += value & 1 ? 1 : -1;
    }
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}

function cosine(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

interface StoredEntry { passageId: string; hash: string; embedding: number[] }

export class SemanticIndex {
  readonly passages: Array<{ document: SourceDocument; passage: Passage; vector: number[] }>;
  readonly modelId = MODEL_ID;

  constructor(documents: SourceDocument[]) {
    const statePath = process.env.RUNTIME_STATE_PATH ? join(process.env.RUNTIME_STATE_PATH, "semantic-index.json") : undefined;
    let stored = new Map<string, StoredEntry>();
    if (statePath && existsSync(statePath)) {
      try { stored = new Map((JSON.parse(readFileSync(statePath, "utf8")) as StoredEntry[]).map((entry) => [entry.passageId, entry])); } catch { stored = new Map(); }
    }
    this.passages = documents.flatMap((document) => extractPassages(document).map((passage) => {
      const indexedText = `${document.title} ${passage.heading} ${passage.text}`;
      const contentHash = createHash("sha256").update(indexedText, "utf8").digest("hex");
      const cached = stored.get(passage.id);
      return { document, passage, vector: cached?.hash === contentHash ? cached.embedding : embedding(indexedText) };
    }));
    if (statePath) {
      const payload = this.passages.map(({ document, passage, vector }) => ({ passageId: passage.id, hash: createHash("sha256").update(`${document.title} ${passage.heading} ${passage.text}`, "utf8").digest("hex"), embedding: vector }));
      try { mkdirSync(dirname(statePath), { recursive: true }); const temporary = `${statePath}.tmp`; writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600 }); renameSync(temporary, statePath); } catch { /* cache persistence is optional */ }
    }
  }

  search(query: string, limit = 28): SemanticRetrievalCandidate[] {
    const vector = embedding(queryExpansion(query).expanded.join(" "));
    return this.passages.map((entry) => ({ document: entry.document, passage: entry.passage, score: cosine(vector, entry.vector) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.passage.id.localeCompare(right.passage.id))
      .slice(0, limit);
  }
}

let cached: { documents: SourceDocument[]; index: SemanticIndex } | undefined;
export function semanticIndex(documents: SourceDocument[]): SemanticIndex {
  if (cached?.documents === documents) return cached.index;
  cached = { documents, index: new SemanticIndex(documents) };
  return cached.index;
}

export function fuseRetrieval(
  lexical: RetrievalCandidate[],
  semantic: SemanticRetrievalCandidate[],
  limit = 48,
  k = 60,
): RetrievalCandidate[] {
  const fused = new Map<string, RetrievalCandidate>();
  lexical.forEach((candidate, index) => fused.set(candidate.passage.id, {
    ...candidate,
    lexicalScore: candidate.score,
    fusionScore: 1 / (k + index + 1),
  }));
  semantic.forEach((candidate, index) => {
    const existing = fused.get(candidate.passage.id);
    const score = 1 / (k + index + 1);
    if (existing) fused.set(candidate.passage.id, {
      ...existing,
      semanticScore: candidate.score,
      fusionScore: (existing.fusionScore ?? 0) + score,
    });
    else fused.set(candidate.passage.id, {
      document: candidate.document,
      passage: candidate.passage,
      score: candidate.score,
      semanticScore: candidate.score,
      matchedTerms: [],
      queryCoverage: 0,
      fusionScore: score,
    });
  });
  return [...fused.values()]
    .sort((left, right) => (right.fusionScore ?? 0) - (left.fusionScore ?? 0))
    .slice(0, limit);
}
