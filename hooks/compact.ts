/**
 * Level 7: should I compact. Called from hooks/prompt.ts on UserPromptSubmit, the moment a new request arrives.
 *
 * Built from the transcript, in code: earlier requests, the last assistant turn, the tools it used, context tokens.
 * One Jev call (COMPACT_QUESTIONS) and decideTier from the repo pick a tier. Above "notice" a second call
 * (cutPointQuestion) picks which request the live work starts at, and that goes into a ready-made /compact command.
 *
 * Claude cannot compact itself, so the result goes to you as a systemMessage, not to Claude.
 * The first call runs on every request after the first, below the notice line too: its switched_gears answer is what
 * the model router (level 5) uses to decide when to speak. decideTier still keeps it silent below the line.
 * JEV_COMPACT_LINES=notice,recommend,request in tokens (default 60000,100000,140000).
 */
import { level, systemOne, withTimeout } from "../lib/jev.ts";

const [notice, recommend, request] = (process.env.JEV_COMPACT_LINES ?? "60000,100000,140000").split(",").map(Number);
const LINES = { notice, recommend, request };
const WINDOW = Number(process.env.JEV_CONTEXT_WINDOW ?? 200_000);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export interface Session {
  requests: string[];
  /** The model that wrote the last assistant message, e.g. claude-opus-5-5. */
  model?: string;
  summary: string;
  recentTurn: string;
  tools: string[];
  tokens: number;
}

/** A real prompt from you, not a tool result, a slash-command echo or an injected reminder. */
function promptText(e: any): string | null {
  if (e.type !== "user" || e.isMeta || e.isCompactSummary) return null;
  const c = e.message?.content;
  const text = typeof c === "string" ? c
    : Array.isArray(c) && !c.some((b: any) => b?.type === "tool_result") ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
    : "";
  return text.trim() && !text.trimStart().startsWith("<") ? text.trim() : null;
}

/** Everything since the last compaction. */
export function readSession(lines: string[]): Session {
  const s: Session = { requests: [], summary: "", recentTurn: "", tools: [], tokens: 0 };
  for (const line of lines) {
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isCompactSummary || (e.type === "system" && e.subtype === "compact_boundary")) {
      Object.assign(s, { requests: [], recentTurn: "", tools: [], summary: e.isCompactSummary ? textFrom(e.message?.content) : s.summary });
      continue;
    }
    const p = promptText(e);
    if (p) { s.requests.push(p); s.recentTurn = ""; s.tools = []; continue; }
    if (e.type === "assistant") {
      for (const b of e.message?.content ?? []) {
        if (b?.type === "text") s.recentTurn = b.text;
        if (b?.type === "tool_use") s.tools.push(b.name);
      }
      if (e.message?.model) s.model = e.message.model;
      const u = e.message?.usage;
      if (u) s.tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
    }
  }
  return s;
}

const textFrom = (c: any) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "");

export async function evaluate(session: Session, prompt: string) {
  const L7 = await level("level07/index.ts");
  const usage = { tokens: session.tokens, pct: (session.tokens / WINDOW) * 100 };
  // Nothing to move on from yet: no call, no cost.
  if (session.requests.length === 0) return { tier: "silent", reason: "first request since the last compaction", usage, called: false, answers: null };

  const state = {
    current_request: clip(prompt, 600),
    previous_work: [...session.requests.map((r) => clip(r, 200)), session.summary ? `Summary so far: ${clip(session.summary, 400)}` : ""].filter(Boolean).join("\n"),
    recent_turn: clip(session.recentTurn || `(tool calls only: ${session.tools.join(", ") || "none"})`, 600),
    tools_this_turn: [...new Set(session.tools)],
  };
  const { answers } = await withTimeout(systemOne(state, L7.COMPACT_QUESTIONS));
  const decision = L7.decideTier(answers, usage, true, LINES, state);
  if (decision.tier === "silent" || decision.tier === "notice") return { ...decision, usage, called: true, answers };

  // 7C: which request does the live work start at. Includes the new prompt, since that is where it may start.
  const turns = [...session.requests, prompt].map((r, i) => ({ index: i, request: clip(r, 120) }));
  const pick = await withTimeout(systemOne({ turns }, L7.cutPointQuestion(turns)));
  const cut = L7.cutPointInstructions(turns, pick.answers.live_from);
  return { ...decision, usage, called: true, answers, instructions: cut.instructions as string };
}

export function message(r: Awaited<ReturnType<typeof evaluate>>): string | null {
  const at = `${Math.round(r.usage.tokens / 1000)}k tokens`;
  r = { ...r, reason: r.reason.replace(/\s+/g, " ") };
  const run = r.instructions ? `\n  /compact ${r.instructions.replace(/\s+/g, " ").trim()}` : "\n  /compact";
  switch (r.tier) {
    case "notice": return `jev: context at ${at}. ${r.reason} Compacting is optional.`;
    case "recommend": return `jev: compacting recommended (${at}). ${r.reason} When this turn finishes, run:${run}`;
    case "request": return `jev: please compact (${at}). ${r.reason} When this turn finishes, run:${run}`;
    default: return null;
  }
}
