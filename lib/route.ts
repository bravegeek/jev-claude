/**
 * Level 5: model routing. Jev's questions are the repo's routeModel (level05/model-router.ts), unchanged.
 * The thresholds are not. Live runs showed the "least costly model" pick leans fast and is unsure on exactly the tasks
 * that need more (redesigns, intermittent bugs, reviews: powerful at 0.38-0.60), while the effort Score separates
 * cleanly: routine work at 0.98 or below, hard work at 1.36 or above. So effort leads and the pick backs it up.
 */
import { core, systemOne, withTimeout } from "./jev.ts";

export type Claude = "haiku" | "sonnet" | "opus";
export type Tier = "fast" | "middle" | "powerful";
export interface Route { tier: Tier; pick: "fast" | "powerful"; pickConfidence: number; effort: number; rationale: string }

/** Effort Score lines (0 to 2) and the confidence a pick needs to count. Code owns these; Jev owns the judgment. */
export const LINES = { deep: 1.5, light: 1.0, mechanical: 0.75, pick: 0.7 };

export function decideRoute(pick: { choice: string; confidence: number }, effort: { score: number }): Route {
  const p = pick.choice === "powerful" ? "powerful" : "fast";
  const sure = pick.confidence >= LINES.pick;
  const tier: Tier =
    effort.score >= LINES.deep || (p === "powerful" && sure) ? "powerful"
    : effort.score < LINES.light && p === "fast" && sure ? "fast"
    : "middle";
  return { tier, pick: p, pickConfidence: pick.confidence, effort: effort.score, rationale: `${tier}: picked ${p} @ ${pick.confidence.toFixed(2)}, effort ${effort.score.toFixed(2)} of 2` };
}

export async function routeTask(task: string, timeoutMs?: number): Promise<Route> {
  const { choice, score } = await core("helpers.ts");
  const { answers } = await withTimeout(systemOne({ task }, {
    model: choice("Choose the least costly model that can complete `task`.", {
      fast: "Direct lookups, extraction, localized changes",
      powerful: "Architecture, cross-file reasoning, high-stakes decisions",
    }),
    effort: score("How much reasoning effort does `task` need?", [
      "Immediate answer, single fact or mechanical change",
      "Some investigation across a few files",
      "Deep multi-step reasoning with trade-offs",
    ]),
  }), timeoutMs);
  return decideRoute(answers.model, answers.effort);
}

/** Your session: Opus or Sonnet, or null in the middle band, where no suggestion is worth a cache miss. */
export const mainModel = (r: Route): Claude | null => (r.tier === "powerful" ? "opus" : r.tier === "fast" ? "sonnet" : null);

/** A subagent: Haiku only for mechanical work, Sonnet as the safe middle. */
export const subagentModel = (r: Route): Claude =>
  r.tier === "powerful" ? "opus" : r.tier === "fast" && r.effort < LINES.mechanical ? "haiku" : "sonnet";

/** Which side a model ID sits on. Unknown IDs return null and get no suggestion. */
export function tierOf(modelId: string | undefined): "fast" | "powerful" | null {
  if (!modelId) return null;
  if (/opus|fable/i.test(modelId)) return "powerful";
  if (/sonnet|haiku/i.test(modelId)) return "fast";
  return null;
}
