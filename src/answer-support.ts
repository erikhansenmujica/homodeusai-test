import { QUESTION_FRAME_TERMS, RETRIEVAL_LIMITS } from "./domain-config.ts";
import { queryExpansion, tokenize } from "./retrieval.ts";
import type { DecideRequest, RetrievalCandidate } from "./types.ts";

export type AnswerRequirement =
  | "percentage"
  | "currency"
  | "duration"
  | "entitlement"
  | "list"
  | "event"
  | "boolean"
  | "location_or_channel"
  | "individual_state"
  | "general_rule";

export function answerRequirement(question: string): AnswerRequirement {
  const normalized = tokenize(question).join(" ");
  if (/\b(?:saldo|estado solicitacao|estado solicitação|espelho individual|ao vivo)\b/iu.test(normalized)) return "individual_state";
  if (/\b(?:feria|ferias|f[eé]rias|descanso)\b/iu.test(question) &&
      (/\bdireito\b/iu.test(question) || /\bquantos?\s+dias?\b[\s\S]{0,45}\b(?:feria|ferias|f[eé]rias|descanso)\b/iu.test(question))) {
    return "entitlement";
  }
  if (/\b(?:quais)\b[\s\S]{0,30}\bdocument\w*\b|\b(?:lista|relacao)\b[\s\S]{0,30}\bdocument\w*\b/iu.test(normalized)) return "list";
  if (/\b(?:onde|portal|canal|sistema|enviar|entregar)\b/iu.test(normalized) && /\b(?:document|ingresso|admiss)\b/iu.test(normalized)) return "location_or_channel";
  if (/\b(?:correcao|correção|corrigir|fechamento)\b/iu.test(normalized)) return "duration";
  if (/\b(?:extra|extras|horas adicionais|hora adicional|al[eé]m jornada|compensa[cç][aã]o|extraordin[aá]rio|depois do (?:meu )?hor[aá]rio|depois do expediente|pago a mais)\b/iu.test(question)) return "percentage";
  if (/\b(?:percentual|acrescimo|acréscimo|porcentagem)\b/iu.test(normalized)) return "percentage";
  if (/\b(?:valor|quanto|r\$|apoio|refeicao|refeição)\b/iu.test(normalized)) return "currency";
  if (/\b(?:quantos|dias|prazo|antecedencia|antecedência)\b/iu.test(normalized)) return "duration";
  if (/\b(?:quais|documentos|marcacoes|marcações)\b/iu.test(normalized)) return "list";
  if (/\b(?:ponto|marcar|retorno|marcacao|marcação|batida|registro|expediente|jornada)\b/iu.test(normalized)) return "list";
  if (/\b(?:revisao|revisão|humana|manual|analista|escalonamento|automaticamente|automacao|automação|processado)\b/iu.test(normalized)) return "list";
  if (/\b(?:conversa|gestor|chefe|lideran[cç]a|verbal|informal)\b/iu.test(normalized)) return "boolean";
  if (/\b(?:acumula|acumulam|tem|têm|possui|possuem|participa|participam|usa|usam|usar|integra|integram|adere|aderem)\b/iu.test(normalized) &&
      /\b(?:banco de horas|banco|horas)\b/iu.test(question)) return "boolean";
  if (/\b(?:estagio|estági[oa]|estagiari[oa]|instrumento|termo)\b/iu.test(normalized)) return "event";
  if (/\b(?:qual evento|antes que|antes de)\b/iu.test(question)) return "event";
  if (/\b(?:suficiente|significa|equivale|pode confirmar|consegue confirmar|obrigatoria|obrigatório)\b/iu.test(question)) return "boolean";
  return "general_rule";
}

function coreQuestionTerms(question: string): string[] {
  return [...new Set(queryExpansion(question).original.filter((term) =>
    term.length > 2 && !QUESTION_FRAME_TERMS.has(term)))];
}

function candidateTopicCoverage(candidate: RetrievalCandidate, question: string): number {
  const terms = coreQuestionTerms(question);
  if (terms.length === 0) return 0;
  const candidateTerms = new Set(candidate.passage.searchableTokens);
  const supported = terms.filter((term) =>
    queryExpansion(term).expanded.some((variant) => candidateTerms.has(variant))).length;
  return supported / terms.length;
}

function supportsQuestionTopic(candidate: RetrievalCandidate, question: string): boolean {
  return candidateTopicCoverage(candidate, question) > 0;
}

export function retrievalStrength(candidate: RetrievalCandidate): number {
  const lexical = candidate.lexicalScore ?? (candidate.matchedTerms.length > 0 ? candidate.score : 0);
  const reciprocalRankFusion = (candidate.fusionScore ?? 0) * 100;
  return Math.max(lexical, reciprocalRankFusion);
}

function sufficiency(candidate: RetrievalCandidate, requirement: AnswerRequirement, question: string): number {
  const text = candidate.passage.answerText;
  const normalized = tokenize(text).join(" ");
  const hasPercent = /\b\d+(?:[,.]\d+)?\s*%/u.test(text);
  const hasCurrency = /R\$\s*\d+(?:[.,]\d+)?/u.test(text);
  const hasDuration = /\b(?:\d+|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|primeiro|segundo|terceiro|quarto|quinto|sexto)\s+dias?\b/iu.test(text);
  const asksForDocuments = /\bdocument\w*\b/iu.test(question);
  const documentItemCount = [
    /\bidentidade\b/iu,
    /\bcomprovante\b/iu,
    /\bdados cadastrais\b/iu,
    /\bcertid[aã]o\b/iu,
    /\binstrumento educacional\b/iu,
    /\bautoriza[cç][aã]o\b/iu,
  ].filter((pattern) => pattern.test(text)).length;
  const hasSourceDefinedDocumentSet =
    /\b(?:somente|apenas|exclusivamente)\b[\s\S]{0,120}\b(?:itens?|documentos?|comprovantes?)\b[\s\S]{0,120}\b(?:solicitad|exigid|indicad|listad|convite|comunicad)/iu.test(text);
  const hasList = asksForDocuments
    ? documentItemCount >= 2 || hasSourceDefinedDocumentSet
    : /(?:\bitens?\b|\bcomprovante\b|\bcasos?\b).*[;,]|\bidentidade\b.*\bcomprovante\b|\bentrada\b.*\bsa[ií]da\b/iu.test(text);
  const hasEvent = /formaliza[cç][aã]o_confirmada|evento|ap[oó]s.*formaliza|instrumento educacional/iu.test(text);
  const asksInternTimeBank = /\b(?:estagiari[oa]|est[aá]gio|intern)\b.*\bbanco de horas\b|\bbanco de horas\b.*\b(?:estagiari[oa]|est[aá]gio|intern)\b/iu.test(question);
  const hasBoolean = asksInternTimeBank
    ? /\b(?:estagi[aá]ri[oa]s?|est[aá]gio|intern)\b[\s\S]{0,120}\b(?:sem banco de horas|n[aã]o participa do banco de horas)\b/iu.test(text)
    : /\b(?:n[aã]o|sim|suficiente|insuficiente|exige|obrigat)/iu.test(text);
  const hasIndividualStateLimit = /saldo ao vivo|espelho individual|estado de solicita[cç][aã]o/iu.test(text);
  const hasChannel = /\b(?:cais|orla|farol|portal|canal)\b/iu.test(text);
  const entitlementContext = `${candidate.document.title}\n${candidate.passage.heading}\n${candidate.passage.text}`;
  const hasEntitlement = hasDuration &&
    /\b(?:feria|ferias|f[eé]rias|descanso)\b/iu.test(entitlementContext) &&
    /\b(?:direito|conced|usufru|gozo|per[ií]odo aquisitivo|quantos?\s+dias?\s+(?:de\s+)?(?:feria|ferias|f[eé]rias|descanso))\b/iu.test(entitlementContext);
  const hasAnswerShape = {
    percentage: hasPercent,
    currency: hasCurrency,
    duration: hasDuration,
    entitlement: hasEntitlement,
    list: hasList,
    event: hasEvent,
    boolean: hasBoolean,
    individual_state: hasIndividualStateLimit,
    location_or_channel: hasChannel,
    general_rule: normalized.length > 12,
  }[requirement];
  return hasAnswerShape && supportsQuestionTopic(candidate, question) ? 7 : -18;
}

function scopeSpecificity(candidate: RetrievalCandidate, input: DecideRequest): number {
  const scope = candidate.document.eligibility;
  const matches = [scope.legalEntityIds.includes(input.requester.legalEntityId), scope.baseIds.includes(input.requester.baseId),
    scope.relationships.includes(input.requester.relationship), scope.roles.includes(input.requester.role)];
  const restricted = [scope.legalEntityIds, scope.baseIds, scope.relationships, scope.roles]
    .filter((values) => !values.includes("*")).length;
  return matches.filter(Boolean).length * 0.12 + restricted * 0.18;
}

export function rankEligible(
  candidates: RetrievalCandidate[],
  input: DecideRequest,
  requirement: AnswerRequirement,
): RetrievalCandidate[] {
  return candidates.map((candidate) => {
    const authorityScore = candidate.document.authorityTier / 100 * 1.2;
    const scopeScore = scopeSpecificity(candidate, input);
    const sufficiencyScore = sufficiency(candidate, requirement, input.question);
    return {
      ...candidate,
      authorityScore,
      scopeScore,
      sufficiencyScore,
      finalScore: retrievalStrength(candidate) + authorityScore + scopeScore + sufficiencyScore,
    };
  }).sort((left, right) =>
    (right.finalScore ?? 0) - (left.finalScore ?? 0) || retrievalStrength(right) - retrievalStrength(left));
}

function hasIndependentPredicate(value: string): boolean {
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim();
  if (/^(?:qual|quais|quem|como|quando|onde|quanto|quantos|por que|posso|devo|preciso)\b/u.test(normalized)) return true;
  return /^(?:(?:o|a|os|as|um|uma|meu|minha|esse|essa|isso)\s+){0,2}[\p{L}-]+(?:\s+[\p{L}-]+){0,4}\s+\b(?:pode|podem|deve|devem|precisa|precisam|tem|significa|confirma|confirmam|usa|usam|recebe|recebem|fica|ficam|foi|esta|estao|vai|vao|acumula|acumulam|participa|participam|diagnostica|diagnosticar)\b/u.test(normalized);
}

function questionClauses(question: string): string[] {
  const explicit = question.split(/\s*(?:;|\b(?:e\s+tamb[eé]m|al[eé]m disso|bem como)\b)\s*/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const clauses: string[] = [];
  for (const clause of explicit) {
    let split = false;
    for (const match of clause.matchAll(/\s+e\s+/giu)) {
      const index = match.index ?? -1;
      if (index < 0) continue;
      const left = clause.slice(0, index).trim();
      const right = clause.slice(index + match[0].length).trim();
      if (coreQuestionTerms(left).length > 0 && coreQuestionTerms(right).length > 0 && hasIndependentPredicate(right)) {
        clauses.push(left, right);
        split = true;
        break;
      }
    }
    if (!split) clauses.push(clause);
  }
  return clauses.slice(0, 5);
}

export function selectAnswerCandidates(
  eligible: RetrievalCandidate[],
  question: string,
): RetrievalCandidate[] {
  const clauses = questionClauses(question);
  if (clauses.length === 0 || clauses.length > 4) return [];
  const selected = new Map<string, RetrievalCandidate>();
  for (const clause of clauses) {
    const requirement = answerRequirement(clause);
    const best = eligible
      .map((candidate) => ({
        candidate,
        coverage: candidateTopicCoverage(candidate, clause),
        sufficiency: sufficiency(candidate, requirement, clause),
      }))
      .filter((item) =>
        item.sufficiency > 0 &&
        item.coverage >= RETRIEVAL_LIMITS.minimumTopicCoverage &&
        retrievalStrength(item.candidate) >= RETRIEVAL_LIMITS.minimumRelevance)
      .sort((left, right) =>
        (right.candidate.finalScore ?? retrievalStrength(right.candidate)) + right.coverage * 4 -
        ((left.candidate.finalScore ?? retrievalStrength(left.candidate)) + left.coverage * 4))[0]?.candidate;
    if (!best) return [];
    selected.set(best.passage.id, best);
  }
  return [...selected.values()];
}
