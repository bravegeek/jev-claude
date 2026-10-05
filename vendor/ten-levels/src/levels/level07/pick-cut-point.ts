/**
 * Level 7, option C: pick the cut point.
 * When compaction runs, which turn starts the work that is still live? A Choice over the session's turns, each described by the user message that started it. Code turns the pick into the compaction instructions.
 */
import { choice } from "../../core/helpers.ts";
import type { ChoiceAnswer } from "../../core/types.ts";

export interface TurnSummary {
  /** Zero based index in the session. */
  index: number;
  /** The user message that started the turn, trimmed. */
  request: string;
}

/** One Choice over the turns. Keys are the indices, so the pick is always a real turn. */
export function cutPointQuestion(turns: TurnSummary[]) {
  const criteria: Record<string, string> = {};
  for (const t of turns) criteria[String(t.index)] = t.request;
  criteria.none = "Every turn is still live; keep the most recent context only";
  return {
    live_from: choice("Which turn in `turns` starts the work that is still live? Earlier turns can be summarized briefly.", criteria),
  };
}

export interface CutPoint {
  liveFrom: number | null;
  confidence: number;
  instructions: string;
}

/** The pick as compaction instructions. Low confidence falls back to pi's default cut. */
export function cutPointInstructions(turns: TurnSummary[], answer: ChoiceAnswer, floor = 0.6): CutPoint {
  if (answer.choice === "none" || answer.confidence < floor) {
    return { liveFrom: null, confidence: answer.confidence, instructions: "Summarize the earlier work briefly and keep the most recent turns in detail." };
  }
  const idx = Number(answer.choice);
  const turn = turns.find((t) => t.index === idx);
  const from = turn ? `"${turn.request}"` : `turn ${idx}`;
  return {
    liveFrom: idx,
    confidence: answer.confidence,
    instructions: `The live work starts at ${from}. Summarize everything before it in a few lines. Keep the decisions, file paths, and open questions from ${from} onward in full detail.`,
  };
}
