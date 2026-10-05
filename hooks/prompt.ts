/**
 * UserPromptSubmit: level 7 (should I compact) and level 5 (which model) side by side, one Jev call each, in parallel.
 *
 * The model suggestion only speaks when it could matter and is cheap to act on: on the first request, or when level 7
 * says the task changed. Switching models mid-task throws away the prompt cache. It also stays quiet in the router's
 * middle band (see lib/route.ts) and when you are already on the right side.
 * Claude Code hooks cannot change the model, so this tells you; you run /model.
 *
 * JEV_COMPACT=off and JEV_ROUTE=off switch either part off.
 */
import { readFile } from "node:fs/promises";
import { log, readStdin } from "../lib/jev.ts";
import { mainModel, routeTask, tierOf, type Route } from "../lib/route.ts";
import { evaluate, message as compactMessage, readSession, type Session } from "./compact.ts";

const SWITCHED = 0.7;
const NAMES = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

/** The suggestion, or null. `switched` is level 7's switched_gears Noul; null on the first request. */
export function routeMessage(route: Route, session: Session, switched: number | null): string | null {
  const first = session.requests.length === 0;
  if (!first && (switched ?? 0) <= SWITCHED) return null;
  const want = mainModel(route);
  if (!want) return null;
  if (tierOf(session.model) === route.tier) return null;
  const why = route.tier === "powerful" ? "this looks like design, hard debugging or a high-stakes call" : "this looks like a localized or lookup task";
  const on = session.model ? ` (you're on ${session.model})` : "";
  const run = first && !session.model ? `if you're not on ${NAMES[want]} already, run /model ${want}` : `run /model ${want}`;
  return `jev: ${why}, ${NAMES[want]} fits${on}. To switch, ${run}.`;
}

async function main() {
  const doCompact = process.env.JEV_COMPACT !== "off";
  const doRoute = process.env.JEV_ROUTE !== "off";
  if (!doCompact && !doRoute) return;
  const input = await readStdin();
  const prompt = String(input.prompt ?? "");
  // On the first prompt of a session the transcript file does not exist yet.
  const lines = input.transcript_path ? (await readFile(input.transcript_path, "utf8").catch(() => "")).split("\n") : [];
  const session = readSession(lines);

  // Level 7 runs even with JEV_COMPACT=off when routing is on, since routing needs its switched_gears answer.
  const [compact, route] = await Promise.allSettled([
    evaluate(session, prompt),
    doRoute ? routeTask(prompt) : Promise.resolve(null),
  ]);

  const out: string[] = [];
  if (compact.status === "fulfilled" && compact.value) {
    const c = compact.value;
    await log({ hook: "UserPromptSubmit", part: "compact", tier: c.tier, reason: c.reason, tokens: c.usage.tokens, called: c.called });
    const msg = doCompact ? compactMessage(c) : null;
    if (msg) out.push(msg);
  } else if (compact.status === "rejected") {
    await log({ hook: "UserPromptSubmit", part: "compact", error: compact.reason?.message ?? String(compact.reason) });
  }
  if (route.status === "fulfilled" && route.value) {
    const switched = compact.status === "fulfilled" ? (compact.value?.answers?.switched_gears?.noul ?? null) : null;
    const msg = routeMessage(route.value, session, switched);
    await log({ hook: "UserPromptSubmit", part: "route", ...route.value, current: session.model ?? null, switched, suggested: !!msg });
    if (msg) out.push(msg);
  } else if (route.status === "rejected") {
    await log({ hook: "UserPromptSubmit", part: "route", error: route.reason?.message ?? String(route.reason) });
  }
  if (out.length) process.stdout.write(JSON.stringify({ systemMessage: out.join("\n") }));
}

if (import.meta.main) await main().catch((err) => log({ hook: "UserPromptSubmit", error: err?.message ?? String(err) }));
