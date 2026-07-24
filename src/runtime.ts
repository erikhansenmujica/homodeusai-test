import { createHash } from "node:crypto";
import { loadSourceDocuments } from "./corpus.ts";
import { assertDomainConfigValid } from "./domain-config.ts";
import { learnedSemanticIndex } from "./learned-semantic.ts";
import { assertHandoffStoreHealthy } from "./queue.ts";
import { lexicalIndex } from "./retrieval.ts";
import { semanticIndex, type SemanticRetrievalCandidate } from "./semantic.ts";
import { assertTraceStoreHealthy } from "./traces.ts";
import type { SourceDocument } from "./types.ts";

export type RuntimeStatus = "initializing" | "ready_learned" | "ready_degraded" | "failed";
export type RetrievalMode = "learned" | "degraded";

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
        await learnedSemanticIndex(documents).search("políticas e processos de People Operations", 1);
        retrievalMode = "learned";
      } catch {
        semanticIndex(documents).search("políticas e processos de People Operations", 1);
      }
    } else {
      semanticIndex(documents).search("políticas e processos de People Operations", 1);
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
    return { candidates: await learnedSemanticIndex(documents).search(question, limit), mode: "learned" };
  }
  return { candidates: semanticIndex(documents).search(question, limit), mode: "degraded" };
}
