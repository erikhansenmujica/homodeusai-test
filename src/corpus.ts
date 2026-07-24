import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "./types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CORPUS_PATH = join(ROOT, "case-data");
let cached: { path: string; documents: SourceDocument[] } | null = null;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveDocumentFile(corpusPath: string): string {
  if (corpusPath.endsWith(".json") && existsSync(corpusPath)) return corpusPath;
  const candidates = [
    join(corpusPath, "source-documents.json"),
    join(corpusPath, "development", "source-documents.json"),
  ];
  const hit = candidates.find(existsSync);
  if (!hit) throw new Error(`No source-documents.json found beneath ${corpusPath}`);
  return hit;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseDocument(value: unknown, index: number): SourceDocument {
  if (!isRecord(value)) throw new Error(`Corpus document ${index} is not an object`);
  const eligibility = isRecord(value.eligibility) ? value.eligibility : {};
  const required = [
    "sourceId",
    "versionId",
    "title",
    "sourceType",
    "domain",
    "audience",
    "approval",
    "policySensitivity",
    "effectiveFrom",
    "deliveryFileId",
    "originalFormat",
    "extractionMode",
    "content",
    "contentSha256",
  ];
  for (const field of required) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`Corpus document ${index} is missing ${field}`);
    }
  }
  if (typeof value.authorityTier !== "number" || !Number.isFinite(value.authorityTier)) {
    throw new Error(`Corpus document ${index} has an invalid authorityTier`);
  }
  if (!["PDF", "DOCX", "XLSX", "PPTX"].includes(value.originalFormat as string)) {
    throw new Error(`Corpus document ${index} has an invalid originalFormat`);
  }
  if (!["ocr", "digital_text", "structured"].includes(value.extractionMode as string)) {
    throw new Error(`Corpus document ${index} has an invalid extractionMode`);
  }
  if (typeof value.ocrReviewed !== "boolean") {
    throw new Error(`Corpus document ${index} has an invalid ocrReviewed flag`);
  }
  if (typeof value.expectedCharacters !== "number" || value.expectedCharacters !== (value.content as string).length) {
    throw new Error(`Corpus document ${index} has an invalid expectedCharacters value`);
  }
  if (!["employee", "internal", "restricted"].includes(value.audience as string)) {
    throw new Error(`Corpus document ${index} has an invalid audience`);
  }
  if (!["approved", "pending", "rejected"].includes(value.approval as string)) {
    throw new Error(`Corpus document ${index} has an invalid approval state`);
  }
  if (!["low", "medium", "high"].includes(value.policySensitivity as string)) {
    throw new Error(`Corpus document ${index} has an invalid policySensitivity`);
  }
  if (Number.isNaN(Date.parse(value.effectiveFrom as string))) {
    throw new Error(`Corpus document ${index} has an invalid effectiveFrom date`);
  }
  if (typeof value.effectiveTo === "string" && Number.isNaN(Date.parse(value.effectiveTo))) {
    throw new Error(`Corpus document ${index} has an invalid effectiveTo date`);
  }
  for (const axis of ["legalEntityIds", "baseIds", "roles", "relationships"] as const) {
    if (!Array.isArray(eligibility[axis]) || eligibility[axis].length === 0) {
      throw new Error(`Corpus document ${index} is missing eligibility.${axis}`);
    }
  }

  const content = (value.content as string).normalize("NFC");
  const digest = sha256(content);
  if (digest !== value.contentSha256) {
    throw new Error(`Corpus integrity check failed for ${String(value.sourceId)}@${String(value.versionId)}`);
  }

  return {
    sourceId: value.sourceId as string,
    versionId: value.versionId as string,
    title: value.title as string,
    sourceType: value.sourceType as string,
    domain: value.domain as string,
    audience: value.audience as SourceDocument["audience"],
    approval: value.approval as SourceDocument["approval"],
    policySensitivity: value.policySensitivity as SourceDocument["policySensitivity"],
    authorityTier: value.authorityTier,
    effectiveFrom: value.effectiveFrom as string,
    effectiveTo: typeof value.effectiveTo === "string" ? value.effectiveTo : undefined,
    supersedes: asStringArray(value.supersedes),
    eligibility: {
      legalEntityIds: asStringArray(eligibility.legalEntityIds),
      baseIds: asStringArray(eligibility.baseIds),
      roles: asStringArray(eligibility.roles),
      relationships: asStringArray(eligibility.relationships),
    },
    content,
    contentSha256: digest,
    relativePath: typeof value.relativePath === "string" ? value.relativePath : "",
    deliveryFileId: value.deliveryFileId as string,
    originalFormat: value.originalFormat as SourceDocument["originalFormat"],
    extractionMode: value.extractionMode as SourceDocument["extractionMode"],
    ocrReviewed: value.ocrReviewed,
    expectedCharacters: value.expectedCharacters,
    faqCategory: typeof value.faqCategory === "string" ? value.faqCategory : undefined,
    faqRows: typeof value.faqRows === "number" ? value.faqRows : undefined,
  };
}

export function corpusPath(): string {
  return resolve(process.env.CORPUS_PATH || process.env.GAUNTLET_CORPUS_DIR || DEFAULT_CORPUS_PATH);
}

export function loadSourceDocuments(): SourceDocument[] {
  const path = corpusPath();
  if (cached?.path === path) return cached.documents;
  const file = resolveDocumentFile(path);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.documents) ? parsed.documents : null;
  if (!rows) throw new Error(`${file} must contain an array or { documents: [] }`);
  const documents = rows.map(parseDocument);
  const ids = new Set<string>();
  for (const document of documents) {
    const key = `${document.sourceId}@${document.versionId}`;
    if (ids.has(key)) throw new Error(`Duplicate corpus document ${key}`);
    ids.add(key);
  }
  cached = { path, documents };
  return documents;
}

export function clearCorpusCacheForTest(): void {
  cached = null;
}
