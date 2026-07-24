import type { Passage, RetrievalCandidate, RetrievalRun, SourceDocument } from "./types.ts";
import { QUERY_CONCEPTS, SYNONYM_GROUPS } from "./domain-config.ts";

const PORTUGUESE_STOPWORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "eu",
  "existe", "foi", "me", "meu", "minha", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por",
  "precisa", "qual", "quais", "que", "se", "sem", "ser", "sou", "um", "uma", "meus", "minhas", "isso", "esta", "vale",
  "este", "essa", "esse", "já", "ja", "the", "is", "what", "how", "when", "where", "my",
]);

const synonymMap = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  const normalized = [...new Set(group.map((term) => normalizeToken(term)))];
  for (const term of normalized) synonymMap.set(term, normalized);
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}_-]+/gu, "");
}

export function tokenize(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(normalizeToken)
    .filter((term) => term.length > 1 && !PORTUGUESE_STOPWORDS.has(term));
}

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of synonymMap.get(token) ?? []) expanded.add(synonym);
  }
  return [...expanded];
}

export function queryExpansion(question: string): { original: string[]; expanded: string[]; concepts: string[] } {
  const original = tokenize(question);
  const expanded = new Set(expandTokens(original));
  const concepts: string[] = [];
  for (const [name, definition] of Object.entries(QUERY_CONCEPTS)) {
    if (definition.triggers.some((term) => original.includes(normalizeToken(term)))) {
      concepts.push(name);
      for (const term of definition.terms) expanded.add(normalizeToken(term));
    }
  }
  return { original, expanded: [...expanded], concepts };
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

function passage(
  document: SourceDocument,
  heading: string,
  text: string,
  startCharacter: number,
  sequence: number,
): Passage {
  const answerText = cleanAnswer(text);
  const titleTokens = tokenize(`${document.title} ${document.domain}`);
  const headingTokens = tokenize(heading);
  const contentTokens = tokenize(text);
  return {
    id: `${document.sourceId}:${sequence}`,
    sourceId: document.sourceId,
    versionId: document.versionId,
    domain: document.domain,
    title: document.title,
    heading,
    text,
    answerText,
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
  const matches = [...document.content.matchAll(/^FAQ_ROW\|[^\n]+[\s\S]*?(?=^FAQ_ROW\||(?![\s\S]))/gmu)];
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
    const queryTokens = expansion.expanded;
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
      const matchedTerms: string[] = [];
      for (const token of queryTokens) {
        const frequency = frequencies.get(token) ?? 0;
        const titleFrequency = titleFrequencies.get(token) ?? 0;
        const headingFrequency = headingFrequencies.get(token) ?? 0;
        if (frequency + titleFrequency + headingFrequency === 0) continue;
        matchedTerms.push(token);
        const documentFrequency = this.documentFrequency.get(token) ?? 0;
        const inverseFrequency = Math.log(1 + (passageCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const normalization = frequency + 1.2 * (1 - 0.75 + 0.75 * item.tokens.length / this.averageLength);
        const expansionWeight = rawTokens.includes(token) ? 1 : 0.42;
        const body = inverseFrequency * (frequency * 2.2 / Math.max(1, normalization)) * expansionWeight;
        const title = inverseFrequency * titleFrequency * 1.1 * expansionWeight;
        const heading = inverseFrequency * headingFrequency * 1.8 * expansionWeight;
        bodyScore += body;
        titleScore += title;
        headingScore += heading;
        score += body + title + heading;
      }
      const rawMatched = rawTokens.filter((token) =>
        frequencies.has(token) || titleFrequencies.has(token) || headingFrequencies.has(token)).length;
      score += rawMatched * 0.55;
      const coveredConcepts = rawTokens.filter((token) =>
        (synonymMap.get(token) ?? [token]).some((term) =>
          frequencies.has(term) || titleFrequencies.has(term) || headingFrequencies.has(term))).length;
      const queryCoverage = coveredConcepts / Math.max(1, rawTokens.length);
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
    return { queryTokens: rawTokens, expandedTerms: queryTokens.filter((term) => !rawTokens.includes(term)), concepts: expansion.concepts, candidates: candidates.slice(0, limit) };
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
