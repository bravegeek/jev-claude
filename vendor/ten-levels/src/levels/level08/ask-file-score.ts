/**
 * Level 8, option C: ask_jev_file_score.
 * One file, one scale the agent writes, low to high. "How risky is a refactor of this file?" comes back as a position on the agent's own levels.
 */
import { jev } from "../../core/client.ts";
import { score } from "../../core/helpers.ts";
import type { ScoreAnswer } from "../../core/types.ts";
import type { Decide } from "./ask-file-bool.ts";
import { readFileState } from "./read-state.ts";

export interface FileScore {
  path: string;
  score: number;
  top: number;
  nearest: string;
  confidence: number;
  legend: Record<string, string>;
  usage?: unknown;
}

/** C: levels are situations, not degrees. The nearest level's text comes back so the agent can quote it. */
export async function askFileScore(
  path: string,
  question: string,
  levels: string[],
  cwd: string,
  decide: Decide = (s, q) => jev.systemOne(s, q),
): Promise<FileScore> {
  const state = await readFileState(path, cwd);
  const { answers, usage } = await decide(state, { answer: score(question, levels) });
  const a = answers.answer as ScoreAnswer;
  const top = levels.length - 1;
  return { path, score: a.score, top, nearest: a.legend[String(Math.round(a.score))] ?? "", confidence: a.confidence, legend: a.legend, usage };
}
