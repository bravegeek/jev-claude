/**
 * Level 9, option C: pick the file to open first.
 * A second pass over what the first pass found: one Choice over the surviving paths, keyed by path, so the pick is always a real file. Code prunes the list to the cap before the call.
 */
import { jev } from "../../core/client.ts";
import { choice } from "../../core/helpers.ts";
import { LIMITS, type ChoiceAnswer } from "../../core/types.ts";
import type { Decide } from "./ask-files.ts";

export interface Candidate {
  path: string;
  /** One line the first pass produced, for example the answers gist. Optional. */
  note?: string;
}

export interface FirstPick {
  path: string | null;
  confidence: number;
  probabilities: Record<string, number>;
}

/** Keys are the paths themselves. `none` is the exit when nothing fits. */
export function pickQuestion(question: string, candidates: Candidate[]) {
  const criteria: Record<string, string | null> = {};
  for (const c of candidates.slice(0, LIMITS.MAX_CHOICE_OPTIONS - 1)) criteria[c.path] = c.note ?? null;
  criteria.none = "No file in the list fits";
  return { pick: choice(question, criteria) };
}

export async function pickFirstFile(question: string, candidates: Candidate[], decide: Decide = (s, q) => jev.systemOne(s, q), floor = 0.3): Promise<FirstPick> {
  if (!candidates.length) return { path: null, confidence: 0, probabilities: {} };
  const state = { question, files: candidates.map((c) => c.path) };
  const { answers } = await decide(state, pickQuestion(question, candidates));
  const a = answers.pick as ChoiceAnswer;
  const path = a.choice === "none" || a.confidence < floor ? null : a.choice;
  return { path, confidence: a.confidence, probabilities: a.probabilities };
}
