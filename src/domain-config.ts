export const DOMAIN_CONFIG_VERSION = "people-ops-v1";

export const RETRIEVAL_LIMITS = {
  minimumRelevance: 2.35,
  minimumTopicCoverage: 0.6,
  maximumGovernedCandidates: 28,
} as const;

export const QUESTION_FRAME_TERMS = new Set([
  "aplica", "aplicavel", "antecedencia", "colaborador", "colaboradora", "como", "devo", "dia", "dias",
  "adicionais", "alem", "antes", "comeco", "depois", "deve", "devem", "direito", "direitos", "durante", "empresa", "empregado", "empregada",
  "formaliza", "formalizar", "informal", "informar", "iniciar", "mais", "necessario", "obrigatoriamente", "ocorrer",
  "periodo", "pessoa", "politica", "possa", "posso", "prazo", "processo",
  "precisa", "precisam", "preciso", "procedimento", "pode", "podem", "qual", "quais", "quando", "quanto",
  "quantos", "realizada", "realizadas", "registrar", "regra", "relacao", "sao", "sujeito", "tem", "tenho", "ter", "tipo",
  "situacoes", "suficiente", "trabalhar", "trabalhada", "trabalhadas", "valor", "onde", "percentual", "diariamente",
  "exigido", "exigidos", "lista", "listas", "ele", "ela", "eles", "elas", "isso", "isto", "aquilo",
  "esse", "essa", "esses", "essas", "este", "esta", "estes", "estas", "tambem", "pago", "paga", "pagos", "pagas",
]);

export const SYNONYM_GROUPS = [
  ["comprovante", "holerite", "contracheque", "recibo"],
  ["folha", "pagamento", "salario", "salário", "credito", "crédito"],
  ["feria", "ferias", "férias", "descanso", "folga"],
  ["demissao", "demissão", "desligamento", "rescisao", "rescisão", "encerramento"],
  ["admissao", "admissão", "admission", "ingresso", "contratacao", "contratação", "onboarding"],
  ["candidato", "candidata", "candidatos", "candidatas"],
  ["ponto", "jornada", "marcacao", "marcação", "registro"],
  ["marca", "marcas", "marcacao", "marcação", "registro", "registros"],
  ["hora", "horas", "extra", "extras", "adicional", "adicionais"],
  ["atestado", "laudo", "documento", "medico", "médico", "clinico", "clínico"],
  ["chat", "mensagem", "whatsapp", "email", "e-mail"],
  ["pessoa", "humano", "humana", "atendente", "analista"],
  ["vale", "auxilio", "auxílio", "apoio", "beneficio", "benefício"],
  ["percentual", "percentuais", "acrescimo", "acréscimo", "acrescenta"],
  ["alimentacao", "alimentação", "refeicao", "refeição"],
  ["prazo", "quando", "data", "antecedencia", "antecedência"],
  ["documentos", "documento", "instrumento", "formalizacao", "formalização"],
  ["corrigir", "correcao", "correção", "ajustar", "ajuste"],
  ["estagiario", "estagiário", "estagiaria", "estagiária", "estagiarios", "estagiárias", "estagio", "estágio", "intern"],
  ["aprendiz", "apprentice"],
  ["prestador", "contratado", "contractor"],
  ["dados", "cadastro", "cadastral", "endereco", "endereço"],
  ["incidente", "acidente", "emergencia", "emergência", "urgente", "urgencia", "urgência"],
  ["formaliza", "formalizar", "formalizacao", "formalização"],
  ["autorizado", "autorizada", "autorizados", "autorizadas", "autorizacao", "autorização"],
  ["solicitacao", "solicitação", "pedido", "requerimento"],
  ["envio", "enviar", "submissao", "submissão", "submeter"],
  ["aprovacao", "aprovação", "aprovado", "aprovada", "aprovar"],
  ["trabalho", "trabalhar", "trabalhado", "trabalhada", "trabalhados", "trabalhadas", "laborado", "laborada"],
] as const;

export const QUERY_CONCEPTS = {
  timekeeping_marks: { triggers: ["ponto", "marcacao", "registro", "batida", "expediente", "jornada", "marcar", "retorno", "intervalo"], terms: ["entrada", "inicio", "fim", "intervalo", "saida", "registram"] },
  overtime_compensation: { triggers: ["extra", "extras", "adicional", "acrescimo", "recebo", "horario", "compensacao", "extraordinario", "expediente"], terms: ["horas", "adicionais", "autorizadas", "percentual"] },
  internship_instrument: { triggers: ["estagio", "estagiario", "estagiaria", "instrumento", "termo", "acordo"], terms: ["instrumento", "educacional", "assinado", "formalizacao"] },
  intern_time_bank: { triggers: ["estagio", "estagiario", "estagiaria", "intern", "banco"], terms: ["estagiarios", "presenca", "sem", "banco", "horas"] },
  termination_start: { triggers: ["desligamento", "encerramento", "rescisao", "saida", "offboarding", "gestor", "chefe", "conversa", "verbal"], terms: ["decisao", "formal", "registrada", "responsavel"] },
  mandatory_human_review: { triggers: ["revisao", "humana", "manual", "analista", "escalonamento", "excecao", "intervencao", "automaticamente", "automacao", "processado"], terms: ["estabilidade", "afastamento", "conflito", "documental", "dado", "pessoal", "revisao"] },
  meal_support: { triggers: ["refeicao", "alimentacao", "auxilio", "beneficio", "apoio"], terms: ["apoio", "diario", "elegivel", "r$"] },
} as const;

export function assertDomainConfigValid(): void {
  if (!/^people-ops-v\d+$/u.test(DOMAIN_CONFIG_VERSION)) throw new Error("domain configuration version is invalid");
  if (
    RETRIEVAL_LIMITS.minimumRelevance <= 0
    || RETRIEVAL_LIMITS.minimumTopicCoverage <= 0
    || RETRIEVAL_LIMITS.minimumTopicCoverage > 1
    || RETRIEVAL_LIMITS.maximumGovernedCandidates < 1
  ) {
    throw new Error("retrieval limits are invalid");
  }
  if (SYNONYM_GROUPS.some((group) => group.length < 2 || group.some((term) => !term.trim()))) {
    throw new Error("synonym configuration is invalid");
  }
  if (Object.values(QUERY_CONCEPTS).some((concept) =>
    !concept.triggers[0] || !concept.terms[0])) {
    throw new Error("query concept configuration is invalid");
  }
}
