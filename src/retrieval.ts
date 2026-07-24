import type { Passage, RetrievalCandidate, RetrievalRun, SourceDocument } from "./types.ts";

const PORTUGUESE_STOPWORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "eu",
  "existe", "foi", "me", "meu", "minha", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por",
  "precisa", "qual", "quais", "que", "se", "sem", "ser", "sou", "um", "uma", "meus", "minhas", "isso", "esta", "vale",
  "este", "essa", "esse", "já", "ja", "the", "is", "what", "how", "when", "where", "my",
]);

const SYNONYM_GROUPS = [
  ["comprovante", "holerite", "contracheque", "recibo"],
  ["folha", "pagamento", "salario", "salário", "credito", "crédito"],
  ["ferias", "férias", "descanso", "folga"],
  ["demissao", "demissão", "desligamento", "rescisao", "rescisão", "encerramento"],
  ["admissao", "admissão", "ingresso", "contratacao", "contratação", "onboarding"],
  ["ponto", "jornada", "marcacao", "marcação", "registro"],
  ["hora", "horas", "extra", "extras", "adicional", "adicionais"],
  ["atestado", "laudo", "documento", "medico", "médico", "clinico", "clínico"],
  ["chat", "mensagem", "whatsapp", "email", "e-mail"],
  ["pessoa", "humano", "humana", "atendente", "analista"],
  ["vale", "auxilio", "auxílio", "apoio", "beneficio", "benefício"],
  ["percentual", "percentuais", "acrescimo", "acréscimo"],
  ["alimentacao", "alimentação", "refeicao", "refeição"],
  ["prazo", "quando", "data", "antecedencia", "antecedência"],
  ["corrigir", "correcao", "correção", "ajustar", "ajuste"],
  ["estagiario", "estagiário", "estagio", "estágio", "intern"],
  ["aprendiz", "apprentice"],
  ["prestador", "contratado", "contractor"],
  ["dados", "cadastro", "cadastral", "endereco", "endereço"],
  ["incidente", "acidente", "emergencia", "emergência", "urgente", "urgencia", "urgência"],
] as const;

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
  const titleTokens = tokenize(`${document.title} ${document.domain} ${heading}`);
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
    tokens: contentTokens,
    searchableTokens: [...titleTokens, ...titleTokens, ...contentTokens],
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
      for (const paragraph of sectionBody.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean)) {
        const headingLine = match[0].match(/^#{1,3}\s+[^\n]+/u)?.[0] ?? match[1];
        const fullText = `${headingLine}\n${paragraph}`;
        const localStart = match[0].indexOf(paragraph);
        markdownPassages.push(passage(
          document,
          match[1].trim(),
          fullText,
          absoluteBodyStart + (match.index ?? 0) + Math.max(0, localStart) - headingLine.length - 1,
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
    const rawTokens = tokenize(question);
    const queryTokens = expandTokens(rawTokens);
    const candidates: RetrievalCandidate[] = [];
    const passageCount = this.passages.length;
    for (const item of this.passages) {
      const frequencies = new Map<string, number>();
      for (const token of item.searchableTokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      let score = 0;
      const matchedTerms: string[] = [];
      for (const token of queryTokens) {
        const frequency = frequencies.get(token) ?? 0;
        if (frequency === 0) continue;
        matchedTerms.push(token);
        const documentFrequency = this.documentFrequency.get(token) ?? 0;
        const inverseFrequency = Math.log(1 + (passageCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
        const normalization = frequency + 1.2 * (1 - 0.75 + 0.75 * item.searchableTokens.length / this.averageLength);
        score += inverseFrequency * (frequency * 2.2 / normalization);
      }
      const rawMatched = rawTokens.filter((token) => frequencies.has(token)).length;
      score += rawMatched * 0.55;
      const coveredConcepts = rawTokens.filter((token) =>
        (synonymMap.get(token) ?? [token]).some((term) => frequencies.has(term))).length;
      const queryCoverage = coveredConcepts / Math.max(1, rawTokens.length);
      const normalizedQuestion = normalizeToken(question.replace(/\s+/gu, " "));
      const normalizedAnswer = normalizeToken(item.answerText.replace(/\s+/gu, " "));
      if (normalizedQuestion.length > 8 && normalizedAnswer.includes(normalizedQuestion)) score += 3;
      if (score > 0) {
        const document = this.documents.find((source) =>
          source.sourceId === item.sourceId && source.versionId === item.versionId);
        if (document) candidates.push({ document, passage: item, score, matchedTerms, queryCoverage });
      }
    }
    candidates.sort((left, right) =>
      right.score - left.score ||
      right.document.authorityTier - left.document.authorityTier ||
      left.passage.id.localeCompare(right.passage.id));
    return { queryTokens, candidates: candidates.slice(0, limit) };
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
