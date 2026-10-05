/**
 * Level 8, option B: ask_jev_file_choice.
 * One file, one pick from options the agent names. "Which layer is this file?" comes back as one of the agent's own keys, with the whole distribution.
 */
import { jev } from "../../core/client.ts";
import { choice } from "../../core/helpers.ts";
import type { ChoiceAnswer } from "../../core/types.ts";
import type { Decide } from "./ask-file-bool.ts";
import { readFileState } from "./read-state.ts";

export interface FileChoice {
  path: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  usage?: unknown;
}

/** B: options are name to description. An `other` entry is added when the agent leaves none, so the model has an exit. */
export async function askFileChoice(
  path: string,
  question: string,
  options: Record<string, string>,
  cwd: string,
  decide: Decide = (s, q) => jev.systemOne(s, q),
): Promise<FileChoice> {
  const state = await readFileState(path, cwd);
  const criteria = { ...options };
  if (!("other" in criteria) && !("none" in criteria) && !("none_of_the_above" in criteria)) criteria.other = "None of the above";
  const { answers, usage } = await decide(state, { answer: choice(question, criteria) });
  const a = answers.answer as ChoiceAnswer;
  return { path, choice: a.choice, confidence: a.confidence, probabilities: a.probabilities, usage };
}
