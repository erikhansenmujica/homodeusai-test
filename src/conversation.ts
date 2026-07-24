import { tokenize } from "./retrieval.ts";
import type { DecideRequest, HistoryTurn } from "./types.ts";

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
}

export function isContextDependentFollowup(question: string): boolean {
  const text = normalize(question).trim();
  if (tokenize(text).length > 24) return false;
  return (
    /\b(?:isso|isto|aquilo|ele|ela|eles|elas|esse|essa|esses|essas|este|esta|estes|estas|nesse caso|neste caso|o mesmo|a mesma)\b/u.test(text)
    || /^(?:e|mas|entao|nesse caso|neste caso)\b/u.test(text)
    || /\b(?:solicitacao|pedido|requerimento|processo|envio|submissao|aprovacao|prazo|percentual|valor|canal|documento)\b/u.test(text)
  );
}

function completedUserQuestions(
  history: HistoryTurn[],
  isPeopleOpsQuestion: (question: string) => boolean,
): string[] {
  const questions: string[] = [];
  let stablePeopleOpsTopic = false;
  for (let index = 0; index < history.length - 1; index += 1) {
    const turn = history[index];
    const completion = history[index + 1];
    if (turn?.role !== "user" || completion?.role !== "assistant") continue;
    const explicit = isPeopleOpsQuestion(turn.content);
    const contextual = stablePeopleOpsTopic && isContextDependentFollowup(turn.content);
    if (!explicit && !contextual) continue;
    questions.push(turn.content);
    stablePeopleOpsTopic ||= explicit;
  }
  return questions.slice(-3);
}

export function retrievalQuestionFor(
  input: DecideRequest,
  isPeopleOpsQuestion: (question: string) => boolean,
): { question: string; usedHistory: boolean; contextualTurns: number } {
  if (!isContextDependentFollowup(input.question)) {
    return { question: input.question, usedHistory: false, contextualTurns: 0 };
  }
  const priorQuestions = completedUserQuestions(input.history ?? [], isPeopleOpsQuestion);
  if (priorQuestions.length === 0) {
    return { question: input.question, usedHistory: false, contextualTurns: 0 };
  }
  return {
    question: `${priorQuestions.map((question, index) =>
      `Pergunta anterior ${index + 1}: ${question}`).join("\n")}\nPergunta complementar: ${input.question}`,
    usedHistory: true,
    contextualTurns: priorQuestions.length,
  };
}
