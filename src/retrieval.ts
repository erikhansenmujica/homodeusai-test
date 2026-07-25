import type { Passage, RetrievalCandidate, RetrievalRun, SourceDocument } from "./types.ts";

function normalizeToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}_-]+/gu, "");
}

export function tokenize(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(normalizeToken)
    .filter((term) => term.length > 1);
}

function characterFeatures(term: string): string[] {
  const characters = [...term];
  if (characters.length < 4) return [];
  const padded = ["^", ...characters, "$"];
  const features: string[] = [];
  for (let index = 0; index <= padded.length - 3; index += 1) {
    features.push(`~${padded.slice(index, index + 3).join("")}`);
  }
  return features;
}

function tokenFeatures(term: string): string[] {
  return [term, ...characterFeatures(term)];
}

export function queryExpansion(question: string): { original: string[]; expanded: string[]; concepts: string[] } {
  const original = tokenize(question);
  return { original, expanded: [...new Set(original.flatMap(tokenFeatures))], concepts: [] };
}

function cleanAnswer(text: string): string {
  const response = text.match(/(?:^|\n)R:\s*([\s\S]*?)(?=\n{2,}|$)/u)?.[1]?.trim();
  if (response) return response;
  return text
    .replace(/^FAQ_ROW\|[^\n]*\n?/u, "")
    .replace(/^P:\s*[^\n]*(?:\n|$)/u, "")
    .replace(/^R:\s*/u, "")
    .replace(/^#{1,3}\s+[^\n]+(?:\n+|$)/u, "")
    .replace(/^CLÁUSULA\s+[^\n]+(?:\n+|$)/iu, "")
    .trim();
}

function sourcePrompt(text: string): string | undefined {
  return text.match(/(?:^|\n)P:\s*([^\n]+)/u)?.[1]?.trim() || undefined;
}

function passage(
  document: SourceDocument,
  heading: string,
  text: string,
  startCharacter: number,
  sequence: number,
): Passage {
  const answerText = cleanAnswer(text);
  const titleTokens = tokenize(`${document.title} ${document.domain}`).flatMap(tokenFeatures);
  const headingTokens = tokenize(heading).flatMap(tokenFeatures);
  const contentTokens = tokenize(text).flatMap(tokenFeatures);
  return {
    id: `${document.sourceId}:${sequence}`,
    sourceId: document.sourceId,
    versionId: document.versionId,
    domain: document.domain,
    title: document.title,
    heading,
    text,
    answerText,
    promptText: sourcePrompt(text),
    startCharacter,
    endCharacter: startCharacter + text.length,
    startByte: Buffer.byteLength(document.content.slice(0, startCharacter), "utf8"),
    endByte: Buffer.byteLength(document.content.slice(0, startCharacter + text.length), "utf8"),
    tokens: contentTokens,
    titleTokens,
    headingTokens,
    searchableTokens: [...titleTokens, ...headingTokens, ...contentTokens],
  };
}

function extractFaqPassages(document: SourceDocument): Passage[] {
  const marker = document.content.search(/^CENÁRIO_OPERACIONAL\|/mu);
  const useful = marker >= 0 ? document.content.slice(0, marker) : document.content;
  const matches = [...useful.matchAll(/^FAQ_ROW\|[^\n]+[\s\S]*?(?=^FAQ_ROW\||(?![\s\S]))/gmu)];
  return matches
    .filter((match) => /\|status=publicada(?:\n|$)/u.test(match[0]))
    .map((match, index) => passage(
      document,
      match[0].match(/^FAQ_ROW\|([^|]+\|[^|]+)/u)?.[1] ?? `FAQ ${index + 1}`,
      match[0].trim(),
      match.index ?? 0,
      index,
    ));
}

function extractStructuredPassages(document: SourceDocument): Passage[] {
  // Synthetic operational scenarios are generated test noise, not approved guidance.
  const marker = document.content.search(/^CENÁRIO_OPERACIONAL\|/mu);
  const useful = marker >= 0 ? document.content.slice(0, marker) : document.content;
  const bodyStart = useful.indexOf("\n\n");
  const body = bodyStart >= 0 ? useful.slice(bodyStart + 2) : useful;
  const absoluteBodyStart = bodyStart >= 0 ? bodyStart + 2 : 0;
  if (/^#{1,3}\s+/mu.test(body)) {
    const sections = [...body.matchAll(/^#{1,3}\s+([^\n]+)\n+([\s\S]*?)(?=^#{1,3}\s+|(?![\s\S]))/gmu)];
    const markdownPassages: Passage[] = [];
    let sequence = 0;
    for (const match of sections) {
      const sectionBody = match[2].trim();
      if (!sectionBody) continue;
      let searchFrom = 0;
      for (const paragraph of sectionBody.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean)) {
        const localStart = match[0].indexOf(paragraph, searchFrom);
        searchFrom = Math.max(searchFrom, localStart + paragraph.length);
        markdownPassages.push(passage(
          document,
          match[1].trim(),
          paragraph,
          absoluteBodyStart + (match.index ?? 0) + Math.max(0, localStart),
          sequence,
        ));
        sequence += 1;
      }
    }
    if (markdownPassages.length > 0) return markdownPassages;
  }
  const blocks = [...body.matchAll(/(?:^|\n\n)([\s\S]*?)(?=\n\n|(?![\s\S]))/gu)];
  const results: Passage[] = [];
  for (const [index, match] of blocks.entries()) {
    const text = match[1].trim();
    if (!text || text.length < 16 || /^(?:source_id|estado=|extração=)/u.test(text)) continue;
    const leadingWhitespace = match[1].indexOf(text);
    const start = absoluteBodyStart + (match.index ?? 0) + Math.max(0, leadingWhitespace);
    const heading = text.split("\n", 1)[0].replace(/^#+\s*/u, "").slice(0, 120);
    results.push(passage(document, heading, text, start, index));
  }
  return results;
}

export function extractPassages(document: SourceDocument): Passage[] {
  const passages = document.sourceType === "faq"
    ? extractFaqPassages(document)
    : extractStructuredPassages(document);
  if (passages.length > 0) return passages;
  return [passage(document, document.title, document.content.slice(0, 3_500), 0, 0)];
}

export class LexicalIndex {
  readonly passages: Passage[];
  readonly documentFrequency = new Map<string, number>();
  readonly averageLength: number;
  readonly documents: SourceDocument[];

  constructor(documents: SourceDocument[]) {
    this.documents = documents;
    this.passages = documents.flatMap(extractPassages);
    for (const item of this.passages) {
      for (const token of new Set(item.searchableTokens)) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
    }
    this.averageLength = this.passages.reduce((sum, item) => sum + item.searchableTokens.length, 0) /
      Math.max(1, this.passages.length);
  }

  search(question: string, limit = 48): RetrievalRun {
    const expansion = queryExpansion(question);
    const rawTokens = expansion.original;
    const queryTokens = [...new Set(expansion.expanded)];
    const candidates: RetrievalCandidate[] = [];
    const passageCount = this.passages.length;
    for (const item of this.passages) {
      const frequencies = new Map<string, number>();
      const titleFrequencies = new Map<string, number>();
      const headingFrequencies = new Map<string, number>();
      for (const token of item.tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      for (const token of item.titleTokens) titleFrequencies.set(token, (titleFrequencies.get(token) ?? 0) + 1);
      for (const token of item.headingTokens) headingFrequencies.set(token, (headingFrequencies.get(token) ?? 0) + 1);
      let score = 0;
      let titleScore = 0;
      let headingScore = 0;
      let bodyScore = 0;
      const matchedFeatures = new Set<string>();
      for (const token of queryTokens) {
        const frequency = frequencies.get(token) ?? 0;
        const titleFrequency = titleFrequencies.get(token) ?? 0;
        const headingFrequency = headingFrequencies.get(token) ?? 0;
        if (frequency + titleFrequency + headingFrequency === 0) continue;
        matchedFeatures.add(token);
        const documentFrequency = this.documentFrequency.get(token) ?? 0;
        const inverseFrequency = Math.log(1 + (passageCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const normalization = frequency + 1.2 * (1 - 0.75 + 0.75 * item.tokens.length / this.averageLength);
        const featureWeight = token.startsWith("~") ? 0.18 : 1;
        const body = inverseFrequency * (frequency * 2.2 / Math.max(1, normalization)) * featureWeight;
        const title = inverseFrequency * titleFrequency * 1.1 * featureWeight;
        const heading = inverseFrequency * headingFrequency * 1.8 * featureWeight;
        bodyScore += body;
        titleScore += title;
        headingScore += heading;
        score += body + title + heading;
      }
      const coverageWeights = rawTokens.map((token) => {
        const frequencies = tokenFeatures(token).map((feature) => this.documentFrequency.get(feature) ?? 0);
        const frequency = Math.max(...frequencies);
        return Math.log(1 + (passageCount - frequency + 0.5) / (frequency + 0.5));
      });
      const matchedTerms: string[] = [];
      const coveredWeight = rawTokens.reduce((sum, token, index) => {
        const features = tokenFeatures(token);
        const exact = matchedFeatures.has(token);
        const character = features.slice(1);
        const ratio = character.length === 0 ? 0
          : character.filter((feature) => matchedFeatures.has(feature)).length / character.length;
        const support = exact ? 1 : ratio >= 0.55 ? ratio * 0.65 : 0;
        if (support > 0) matchedTerms.push(token);
        return sum + coverageWeights[index]! * support;
      }, 0);
      const queryCoverage = coveredWeight / Math.max(Number.EPSILON,
        coverageWeights.reduce((sum, weight) => sum + weight, 0));
      const normalizedQuestion = normalizeToken(question.replace(/\s+/gu, " "));
      const normalizedAnswer = normalizeToken(item.answerText.replace(/\s+/gu, " "));
      if (normalizedQuestion.length > 8 && normalizedAnswer.includes(normalizedQuestion)) score += 3;
      if (score > 0) {
        const document = this.documents.find((source) =>
          source.sourceId === item.sourceId && source.versionId === item.versionId);
        if (document) candidates.push({ document, passage: item, score, titleScore, headingScore, bodyScore, matchedTerms, queryCoverage });
      }
    }
    candidates.sort((left, right) =>
      right.score - left.score ||
      right.document.authorityTier - left.document.authorityTier ||
      left.passage.id.localeCompare(right.passage.id));
    return { queryTokens: rawTokens, expandedTerms: [], concepts: [], candidates: candidates.slice(0, limit) };
  }
}

let cachedIndex: { documents: SourceDocument[]; index: LexicalIndex } | undefined;

export function lexicalIndex(documents: SourceDocument[]): LexicalIndex {
  if (cachedIndex?.documents === documents) return cachedIndex.index;
  const index = new LexicalIndex(documents);
  cachedIndex = { documents, index };
  return index;
}

export function clearLexicalIndexForTest(): void {
  cachedIndex = undefined;
}
