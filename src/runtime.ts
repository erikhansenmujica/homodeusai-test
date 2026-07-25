import { createHash } from "node:crypto";
import { loadSourceDocuments } from "./corpus.ts";
import { assertDomainConfigValid } from "./domain-config.ts";
import { learnedSemanticIndex } from "./learned-semantic.ts";
import { assertHandoffStoreHealthy } from "./queue.ts";
import { lexicalIndex } from "./retrieval.ts";
import { semanticIndex, type SemanticRetrievalCandidate } from "./semantic.ts";
import {
  DeterministicSemanticEmbeddingProvider,
  SemanticPatternIndex,
  type AnswerPattern,
  type CompositionPattern,
  type RoutingIntent,
  type RetrievalConcept,
  type SemanticPatternAnalysis,
  type SemanticEmbeddingProvider,
} from "./semantic-patterns.ts";
import { assertTraceStoreHealthy } from "./traces.ts";
import type { RetrievalCandidate, SourceDocument } from "./types.ts";

export type RuntimeStatus = "initializing" | "ready_learned" | "ready_degraded" | "failed";
export type RetrievalMode = "learned" | "degraded";

export class SemanticProviderUnavailableError extends Error {
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`semantic provider failed during ${operation}`, options);
    this.name = "SemanticProviderUnavailableError";
  }
}

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  retrievalMode?: RetrievalMode;
  corpusVersion?: string;
  documents?: number;
  passages?: number;
  initializationMs?: number;
  error?: string;
}

let snapshot: RuntimeSnapshot = { status: "initializing" };
let initialization: Promise<RuntimeSnapshot> | undefined;
let activeDocuments: SourceDocument[] | undefined;
let activePatternIndex: SemanticPatternIndex | undefined;
let activeEmbeddingProvider: SemanticEmbeddingProvider | undefined;

async function learnedProviderOperation<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new SemanticProviderUnavailableError(operation, { cause: error });
  }
}

function corpusVersion(documents: SourceDocument[]): string {
  return createHash("sha256")
    .update(documents.map((document) =>
      `${document.sourceId}@${document.versionId}:${document.contentSha256}`).sort().join("\n"), "utf8")
    .digest("hex")
    .slice(0, 16);
}

async function initialize(): Promise<RuntimeSnapshot> {
  const started = performance.now();
  snapshot = { status: "initializing" };
  try {
    assertDomainConfigValid();
    const documents = loadSourceDocuments();
    activeDocuments = documents;
    const lexical = lexicalIndex(documents);
    assertHandoffStoreHealthy();
    assertTraceStoreHealthy();

    let retrievalMode: RetrievalMode = "degraded";
    if (process.env.LEARNED_SEMANTIC_ENABLED !== "false") {
      try {
        const learned = learnedSemanticIndex(documents);
        activeEmbeddingProvider = learned.provider;
        activePatternIndex = new SemanticPatternIndex(learned.provider);
        await Promise.all([
          learned.search("general employee policy guidance", 1),
          activePatternIndex.ready(),
        ]);
        retrievalMode = "learned";
      } catch {
        activeEmbeddingProvider = new DeterministicSemanticEmbeddingProvider();
        activePatternIndex = new SemanticPatternIndex(activeEmbeddingProvider);
        await activePatternIndex.ready();
        semanticIndex(documents).search("general employee policy guidance", 1);
      }
    } else {
      activeEmbeddingProvider = new DeterministicSemanticEmbeddingProvider();
      activePatternIndex = new SemanticPatternIndex(activeEmbeddingProvider);
      await activePatternIndex.ready();
      semanticIndex(documents).search("general employee policy guidance", 1);
    }

    snapshot = {
      status: retrievalMode === "learned" ? "ready_learned" : "ready_degraded",
      retrievalMode,
      corpusVersion: corpusVersion(documents),
      documents: documents.length,
      passages: lexical.passages.length,
      initializationMs: Number((performance.now() - started).toFixed(3)),
    };
    return snapshot;
  } catch (error) {
    snapshot = {
      status: "failed",
      initializationMs: Number((performance.now() - started).toFixed(3)),
      error: error instanceof Error ? error.message : "runtime initialization failed",
    };
    return snapshot;
  }
}

export function startRuntimeInitialization(): Promise<RuntimeSnapshot> {
  initialization ??= initialize();
  return initialization;
}

export async function ensureRuntimeReady(): Promise<RuntimeSnapshot> {
  const state = await startRuntimeInitialization();
  if (state.status !== "ready_learned" && state.status !== "ready_degraded") {
    throw new Error(state.error ?? "decision runtime is not ready");
  }
  return state;
}

export function runtimeSnapshot(): RuntimeSnapshot {
  return { ...snapshot };
}

export async function runtimeSemanticSearch(
  documents: SourceDocument[],
  question: string,
  limit = 28,
): Promise<{ candidates: SemanticRetrievalCandidate[]; mode: RetrievalMode }> {
  const state = await ensureRuntimeReady();
  if (documents !== activeDocuments) throw new Error("runtime corpus identity changed after initialization");
  if (state.retrievalMode === "learned") {
    const candidates = await learnedProviderOperation(
      "semantic retrieval",
      () => learnedSemanticIndex(documents).search(question, limit),
    );
    return { candidates, mode: "learned" };
  }
  return { candidates: semanticIndex(documents).search(question, limit), mode: "degraded" };
}

export async function runtimeSemanticSearchMany(
  documents: SourceDocument[],
  questions: string[],
  limit = 28,
): Promise<{ candidates: SemanticRetrievalCandidate[][]; mode: RetrievalMode }> {
  const state = await ensureRuntimeReady();
  if (documents !== activeDocuments) throw new Error("runtime corpus identity changed after initialization");
  if (state.retrievalMode === "learned") {
    return {
      candidates: await learnedProviderOperation(
        "batched semantic retrieval",
        () => learnedSemanticIndex(documents).searchMany(questions, limit),
      ),
      mode: "learned",
    };
  }
  return {
    candidates: questions.map((question) => semanticIndex(documents).search(question, limit)),
    mode: "degraded",
  };
}

export async function runtimeRoutingPatterns(
  texts: string[],
): Promise<Array<SemanticPatternAnalysis<RoutingIntent>>> {
  const state = await ensureRuntimeReady();
  if (!activePatternIndex) throw new Error("semantic pattern index is unavailable");
  const classify = () => activePatternIndex!.classify<RoutingIntent>(texts, "routing", "query");
  return state.retrievalMode === "learned"
    ? learnedProviderOperation("routing classification", classify)
    : classify();
}

export async function runtimeAnswerPatterns(
  texts: string[],
  role: "query" | "passage" = "query",
): Promise<Array<SemanticPatternAnalysis<AnswerPattern>>> {
  const state = await ensureRuntimeReady();
  if (!activePatternIndex) throw new Error("semantic pattern index is unavailable");
  const classify = () => activePatternIndex!.classify<AnswerPattern>(texts, "answer", role);
  return state.retrievalMode === "learned"
    ? learnedProviderOperation("answer-shape classification", classify)
    : classify();
}

export async function runtimeAnswerAlignment(
  documents: SourceDocument[],
  question: string,
  candidates: RetrievalCandidate[],
): Promise<number[]> {
  const state = await ensureRuntimeReady();
  if (documents !== activeDocuments) throw new Error("runtime corpus identity changed after initialization");
  if (candidates.length === 0) return [];
  if (state.retrievalMode === "learned") {
    return learnedProviderOperation(
      "answer alignment",
      () => learnedSemanticIndex(documents).answerAlignments(
        question,
        candidates.map((candidate) => candidate.passage),
      ),
    );
  }
  if (!activeEmbeddingProvider) return [];
  const [[query], passages] = await Promise.all([
    activeEmbeddingProvider.embedQueries([question]),
    activeEmbeddingProvider.embedPassages(candidates.map((candidate) => candidate.passage.answerText)),
  ]);
  return passages.map((passage) =>
    passage.reduce((sum, value, index) => sum + value * (query?.[index] ?? 0), 0));
}

export async function runtimePromptAlignment(
  documents: SourceDocument[],
  question: string,
  candidates: RetrievalCandidate[],
): Promise<Array<number | undefined>> {
  const state = await ensureRuntimeReady();
  if (documents !== activeDocuments) throw new Error("runtime corpus identity changed after initialization");
  if (candidates.length === 0) return [];
  if (state.retrievalMode === "learned") {
    return learnedProviderOperation(
      "source prompt alignment",
      () => learnedSemanticIndex(documents).promptAlignments(
        question,
        candidates.map((candidate) => candidate.passage),
      ),
    );
  }
  if (!activeEmbeddingProvider) return candidates.map(() => undefined);
  const promptCandidates = candidates
    .map((candidate, index) => ({ index, text: candidate.passage.promptText }))
    .filter((candidate): candidate is { index: number; text: string } =>
      candidate.text !== undefined);
  if (promptCandidates.length === 0) return candidates.map(() => undefined);
  const [[query], prompts] = await Promise.all([
    activeEmbeddingProvider.embedQueries([question]),
    activeEmbeddingProvider.embedPassages(promptCandidates.map((candidate) => candidate.text)),
  ]);
  const scores: Array<number | undefined> = candidates.map(() => undefined);
  promptCandidates.forEach((candidate, index) => {
    scores[candidate.index] = prompts[index]!.reduce((sum, value, dimension) =>
      sum + value * (query?.[dimension] ?? 0), 0);
  });
  return scores;
}

export async function runtimeCandidateAnswerPatterns(
  documents: SourceDocument[],
  candidates: RetrievalCandidate[],
): Promise<Array<SemanticPatternAnalysis<AnswerPattern>>> {
  const state = await ensureRuntimeReady();
  if (documents !== activeDocuments) throw new Error("runtime corpus identity changed after initialization");
  if (!activePatternIndex || candidates.length === 0) return [];
  const vectors = state.retrievalMode === "learned"
    ? await learnedProviderOperation(
      "candidate answer embedding",
      () => learnedSemanticIndex(documents).answerEmbeddings(
        candidates.map((candidate) => candidate.passage),
      ),
    )
    : await activeEmbeddingProvider!.embedPassages(
      candidates.map((candidate) => candidate.passage.answerText),
    );
  return activePatternIndex.classifyEmbedded<AnswerPattern>(vectors, "answer");
}

export async function runtimeCompositionPatterns(
  texts: string[],
): Promise<Array<SemanticPatternAnalysis<CompositionPattern>>> {
  const state = await ensureRuntimeReady();
  if (!activePatternIndex) throw new Error("semantic pattern index is unavailable");
  const classify = () => activePatternIndex!.classify<CompositionPattern>(texts, "composition", "query");
  return state.retrievalMode === "learned"
    ? learnedProviderOperation("question-composition classification", classify)
    : classify();
}

export async function runtimeRetrievalPatterns(
  texts: string[],
): Promise<Array<SemanticPatternAnalysis<RetrievalConcept>>> {
  const state = await ensureRuntimeReady();
  if (!activePatternIndex) throw new Error("semantic pattern index is unavailable");
  const classify = () => activePatternIndex!.classify<RetrievalConcept>(texts, "retrieval", "query");
  return state.retrievalMode === "learned"
    ? learnedProviderOperation("retrieval-concept classification", classify)
    : classify();
}
