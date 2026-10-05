/**
 * Level 7, option A: should I compact.
 * At the end of every agent turn, four questions about the work, one call. The numbers, context usage and the lines, stay in code. Jev judges whether the work moved on. The agent hears nothing, a notice, a recommendation, or a request.
 */
import { noul, score } from "../../core/helpers.ts";
import type { NoulAnswer, ScoreAnswer } from "../../core/types.ts";

/** What the hook sends. Built in code from the session, no LLM involved. */
export interface CompactState {
  /** The latest user message, trimmed. */
  current_request: string;
  /** Earlier user messages plus the last compaction summary, trimmed. */
  previous_work: string;
  /** The assistant's last text plus the tools it called, trimmed. */
  recent_turn: string;
  tools_this_turn: string[];
}

export const COMPACT_QUESTIONS = {
  switched_gears: noul("Is `current_request` a different task from `previous_work`?", {
    true: "A new feature, a different file area, a different goal, or an unrelated question",
    false: "The same task continuing, a follow up, a fix to what was just done",
  }),
  at_boundary: noul("Did `recent_turn` finish a unit of work?", {
    true: "Tests passed, a commit was made, a summary was given, or a question was asked of the user",
    false: "Mid task, more steps clearly remain",
  }),
  needs_history: score("How much of `previous_work` does the next step need?", [
    "None; the new work stands alone",
    "Some references, a file name or a decision",
    "Most of it; the work continues directly from it",
  ]),
  mid_operation: noul("Is the agent in the middle of a multi step edit whose partial state only exists in the conversation?", {
    true: "Half applied changes, a plan being executed step by step, an unfinished refactor",
    false: "A clean point, nothing half done",
  }),
};

export interface CompactAnswers {
  switched_gears: NoulAnswer;
  at_boundary: NoulAnswer;
  needs_history: ScoreAnswer;
  mid_operation: NoulAnswer;
}

export type Tier = "silent" | "notice" | "recommend" | "request";

/**
 * Context tokens, not percent: a 1M window makes percent useless for a short session. Low on
 * purpose so a few file reads cross them. pi's keepRecentTokens must sit below the notice line.
 */
export interface Lines {
  notice: number;
  recommend: number;
  request: number;
}
export const DEFAULT_LINES: Lines = { notice: 6000, recommend: 10_000, request: 14_000 };

/** What the gauge reads: tokens in context, and the same as a percent of the model's window. */
export interface Usage {
  tokens: number;
  pct: number;
}

export interface CompactDecision {
  tier: Tier;
  reason: string;
}

const clip = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * The decision, numbers in code. Silent when there is nothing to compact, when the agent is mid
 * operation, or when the work has not moved on. Otherwise the tier follows usage against the lines.
 */
export function decideTier(a: CompactAnswers, usage: Usage, compactable: boolean, lines: Lines, state?: CompactState): CompactDecision {
  if (!compactable) return { tier: "silent", reason: "nothing to compact yet" };
  if (a.mid_operation.noul > 0.6) return { tier: "silent", reason: "mid operation" };
  const switched = a.switched_gears.noul > 0.7;
  const boundary = a.at_boundary.noul > 0.6 && a.needs_history.score < 1;
  if (!switched && !boundary) return { tier: "silent", reason: "same work continuing" };
  if (usage.tokens < lines.notice) return { tier: "silent", reason: "below the notice line" };

  const reason = switched
    ? `The task changed${state ? ` from "${clip(state.previous_work)}" to "${clip(state.current_request)}"` : ""}.`
    : "The last turn finished a unit of work and the next step needs little of the earlier context.";
  if (usage.tokens < lines.recommend) return { tier: "notice", reason };
  if (usage.tokens < lines.request) return { tier: "recommend", reason };
  return { tier: "request", reason };
}

/** The exact text the agent sees on its next call. Silent returns null: nothing is injected. */
export function tierMessage(d: CompactDecision, usage: Usage): string | null {
  const pct = `${Math.round(usage.tokens / 1000)}k tokens, ${usage.pct.toFixed(1)}% of the window`;
  switch (d.tier) {
    case "notice":
      return `Context is at ${pct}. ${d.reason} Compacting is optional. If you do, call compact_now with a short note to yourself.`;
    case "recommend":
      return `Recommended: compact now. Context is at ${pct}. ${d.reason} Call compact_now with a short note to yourself, then continue.`;
    case "request":
      return `Please compact before continuing. Context is at ${pct}. ${d.reason} Call compact_now with a short note to yourself.`;
    default:
      return null;
  }
}
