import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { EvidenceRef, SourceDocument } from "./types.ts";

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function evidenceForQuote(document: SourceDocument, quote: string, fromCharacter = 0): EvidenceRef {
  const normalizedQuote = quote.normalize("NFC");
  const characterStart = document.content.indexOf(normalizedQuote, fromCharacter);
  if (characterStart < 0) throw new Error(`Quote is not present in ${document.sourceId}@${document.versionId}`);
  const before = document.content.slice(0, characterStart);
  const startByte = Buffer.byteLength(before, "utf8");
  const endByte = startByte + Buffer.byteLength(normalizedQuote, "utf8");
  return {
    sourceId: document.sourceId,
    versionId: document.versionId,
    startByte,
    endByte,
    quote: normalizedQuote,
    quoteSha256: sha256Text(normalizedQuote),
  };
}

export function resolveEvidence(document: SourceDocument, evidence: EvidenceRef): boolean {
  if (document.sourceId !== evidence.sourceId || document.versionId !== evidence.versionId) return false;
  const bytes = Buffer.from(document.content, "utf8");
  if (evidence.startByte < 0 || evidence.endByte <= evidence.startByte || evidence.endByte > bytes.byteLength) return false;
  const quote = bytes.subarray(evidence.startByte, evidence.endByte).toString("utf8");
  return quote === evidence.quote && sha256Text(quote) === evidence.quoteSha256;
}
