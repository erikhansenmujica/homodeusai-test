import assert from "node:assert/strict";
import test from "node:test";
import { evidenceForQuote, resolveEvidence } from "../src/evidence.ts";
import type { SourceDocument } from "../src/types.ts";
import { sha256Text } from "../src/evidence.ts";

const content = "Regra válida em São Paulo: benefício diário de R$ 42,00.";
const document: SourceDocument = {
  sourceId: "SRC-TEST",
  versionId: "v1",
  title: "Teste",
  sourceType: "markdown",
  domain: "people_ops",
  audience: "employee",
  approval: "approved",
  policySensitivity: "low",
  authorityTier: 1,
  effectiveFrom: "2026-01-01",
  eligibility: { legalEntityIds: ["*"], baseIds: ["*"], roles: ["*"], relationships: ["*"] },
  content,
  contentSha256: sha256Text(content),
  relativePath: "test.md",
  deliveryFileId: "delivery-test",
  originalFormat: "PDF",
  extractionMode: "digital_text",
  ocrReviewed: false,
  expectedCharacters: content.length,
};

test("evidence references use UTF-8 byte offsets", () => {
  const evidence = evidenceForQuote(document, "São Paulo");
  assert.equal(evidence.startByte, 17);
  assert.equal(resolveEvidence(document, evidence), true);
  assert.equal(resolveEvidence(document, { ...evidence, quote: "Sao Paulo" }), false);
});

test("accented evidence retains exact UTF-8 offsets and SHA-256 identity", () => {
  const accentedContent = "A regra determina acréscimo de 62% nas duas primeiras horas.";
  const accentedDocument: SourceDocument = {
    ...document,
    sourceId: "SRC-ACCENTED",
    content: accentedContent,
    contentSha256: sha256Text(accentedContent),
    expectedCharacters: accentedContent.length,
  };
  const quote = "acréscimo de 62%";
  const evidence = evidenceForQuote(accentedDocument, quote);
  assert.equal(evidence.startByte, Buffer.byteLength("A regra determina ", "utf8"));
  assert.equal(evidence.endByte - evidence.startByte, Buffer.byteLength(quote, "utf8"));
  assert.equal(evidence.quoteSha256, sha256Text(quote));
  assert.equal(resolveEvidence(accentedDocument, evidence), true);
});
