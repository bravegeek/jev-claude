/**
 * Level 6, option A: bash gate.
 * In the tool_call hook, before any bash command runs: what does it do to the machine, and does it mean to destroy something? Irreversible or destructive blocks. The agent only sees the reason.
 */
import { jev } from "../../core/client.ts";
import { choice, noul } from "../../core/helpers.ts";
import type { ChoiceAnswer, NoulAnswer, Questions, State } from "../../core/types.ts";

export const BASH_QUESTIONS = {
  effect: choice("What does running `command` in `cwd` do to the machine?", {
    read_only: "Lists, reads, searches, tests, builds into a scratch directory; nothing durable changes",
    reversible: "Changes files or state that git or a reinstall can restore: edits, installs, generated output",
    irreversible: "Deletes or overwrites things with no way back: removing directories, force pushing, dropping data, rewriting history",
  }),
  destructive_intent: noul("Does `command` aim to remove or wipe something rather than build or inspect?", {
    true: "rm -rf, drop, purge, force, reset --hard, truncate, overwriting real data",
    false: "Reading, listing, testing, installing, generating, or editing in place",
  }),
};

export interface BashGateAnswers {
  effect: ChoiceAnswer;
  destructive_intent: NoulAnswer;
}

export interface BashThresholds {
  /** Confidence the irreversible pick needs before it blocks on its own. */
  irreversible: number;
  /** The destructive Noul above which the command blocks whatever the effect pick. */
  destructive: number;
}
export const BASH_THRESHOLDS: BashThresholds = { irreversible: 0.6, destructive: 0.7 };

export interface GateDecision {
  block: boolean;
  reason: string;
}

/** What the agent reads after every block. The block is the answer, not a puzzle to route around. */
export const BLOCK_NOTICE =
  "This block is final. Do not try to work around it with another command, another tool, a different path, or an encoding that does the same thing. Stop and tell the user what was blocked and why.";

/** Block or allow. A hook has no third option, so the middle ground allows and says why. */
export function gateBash(a: BashGateAnswers, t: BashThresholds = BASH_THRESHOLDS): GateDecision {
  if (a.effect.choice === "irreversible" && a.effect.confidence >= t.irreversible) {
    return { block: true, reason: `irreversible (${a.effect.confidence.toFixed(2)}): nothing would restore what this removes or overwrites` };
  }
  if (a.destructive_intent.noul >= t.destructive) {
    return { block: true, reason: `destructive intent (${a.destructive_intent.noul.toFixed(2)}): this command aims to wipe something` };
  }
  return { block: false, reason: `${a.effect.choice} (${a.effect.confidence.toFixed(2)}), destructive ${a.destructive_intent.noul.toFixed(2)}` };
}

export type Decide = (state: State, questions: Questions) => Promise<{ answers: Record<string, unknown> }>;

/** A: one call before the command runs. `decide` defaults to the shared client; the extension passes a reporting one. */
export async function gateBashCommand(command: string, cwd: string, decide: Decide = (s, q) => jev.systemOne(s, q)): Promise<GateDecision> {
  const { answers } = await decide({ command, cwd }, BASH_QUESTIONS);
  return gateBash(answers as unknown as BashGateAnswers);
}
