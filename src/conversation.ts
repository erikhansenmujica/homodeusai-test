import {
  semanticPatternConfig,
  type RoutingIntent,
  type SemanticPatternAnalysis,
} from "./semantic-patterns.ts";
import type { DecideRequest, HistoryTurn } from "./types.ts";

type RoutingClassifier = (
  texts: string[],
) => Promise<Array<SemanticPatternAnalysis<RoutingIntent>>>;

// Treat only short utterances as contextual so complete policy questions can stand on their own.
export function routingIntentIsContextual(
  analysis: SemanticPatternAnalysis<RoutingIntent>,
  question?: string,
): boolean {
  const threshold = semanticPatternConfig().thresholds.contextReferenceMinimum;
  const score = analysis.scores.contextual_followup ?? 0;
  const isShortFollowUp = question === undefined
    || (question.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= 14;
  return isShortFollowUp && score >= threshold && score >= analysis.best.score - 0.012;
}

// Evaluate historical context with its own text so long standalone questions remain policy topics.
function isStablePolicyTopic(
  analysis: SemanticPatternAnalysis<RoutingIntent>,
  question?: string,
): boolean {
  return analysis.best.id === "policy_guidance"
    || analysis.best.id === "live_individual_state"
    || (
      (analysis.scores.policy_guidance ?? 0) >= 0.75
      && (analysis.scores.policy_guidance ?? 0) >= (analysis.scores.out_of_scope ?? 0) - 0.02
    )
    || routingIntentIsContextual(analysis, question);
}

function completedUserTurns(history: HistoryTurn[]): string[] {
  const completed: string[] = [];
  for (let index = 0; index < history.length - 1; index += 1) {
    const turn = history[index];
    const completion = history[index + 1];
    if (turn?.role === "user" && completion?.role === "assistant") completed.push(turn.content);
  }
  return completed.slice(-3);
}

export async function retrievalQuestionFor(
  input: DecideRequest,
  current: SemanticPatternAnalysis<RoutingIntent>,
  classify: RoutingClassifier,
): Promise<{ question: string; usedHistory: boolean; contextualTurns: number; topicQuestions: string[] }> {
  // Use history only when the current utterance is structurally short enough to be a follow-up.
  if (!routingIntentIsContextual(current, input.question)) {
    return { question: input.question, usedHistory: false, contextualTurns: 0, topicQuestions: [] };
  }
  const completed = completedUserTurns(input.history ?? []);
  if (completed.length === 0) {
    return { question: input.question, usedHistory: false, contextualTurns: 0, topicQuestions: [] };
  }
  const analyses = await classify(completed);
  const questions: string[] = [];
  let stableTopic = false;
  for (let index = 0; index < completed.length; index += 1) {
    const analysis = analyses[index]!;
    // Preserve a completed standalone policy turn as the trusted topic anchor.
    if (isStablePolicyTopic(analysis, completed[index]!)) {
      stableTopic = true;
      questions.push(completed[index]!);
    // Append only short contextual turns after a stable topic has been established.
    } else if (stableTopic && routingIntentIsContextual(analysis, completed[index]!)) {
      questions.push(completed[index]!);
    }
  }
  if (!stableTopic || questions.length === 0) {
    return { question: input.question, usedHistory: false, contextualTurns: 0, topicQuestions: [] };
  }
  return {
    question: [...questions, input.question].join("\n"),
    usedHistory: true,
    contextualTurns: questions.length,
    topicQuestions: questions,
  };
}

export function routingIntentIsTerminal(
  analysis: SemanticPatternAnalysis<RoutingIntent>,
  intent: Exclude<RoutingIntent, "policy_guidance" | "contextual_followup" | "requester_context_override">,
): boolean {
  const config = semanticPatternConfig();
  const definition = config.routingPatterns.find((pattern) => pattern.id === intent);
  const minimum = definition?.terminalMinimum ?? config.thresholds.terminalIntentMinimum;
  const margin = definition?.terminalMargin ?? config.thresholds.terminalIntentMargin;
  return analysis.best.id === intent
    && analysis.best.score >= minimum
    && analysis.best.score - analysis.second.score >= margin;
}

export function routingIntentIsSupported(
  analysis: SemanticPatternAnalysis<RoutingIntent>,
  intent: Exclude<RoutingIntent, "policy_guidance" | "contextual_followup">,
): boolean {
  const config = semanticPatternConfig();
  const definition = config.routingPatterns.find((pattern) => pattern.id === intent);
  const minimum = definition?.terminalMinimum ?? config.thresholds.terminalIntentMinimum;
  const proximity = definition?.terminalMargin ?? config.thresholds.terminalIntentMargin;
  const score = analysis.scores[intent] ?? 0;
  return score >= minimum && analysis.best.score - score <= proximity;
}

export function routingIntentIsPolicy(
  analysis: SemanticPatternAnalysis<RoutingIntent>,
): boolean {
  return analysis.best.id === "policy_guidance" || isStablePolicyTopic(analysis);
}
