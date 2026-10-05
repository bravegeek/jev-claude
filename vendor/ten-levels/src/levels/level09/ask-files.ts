/**
 * Level 9, option A: ask_jev_files.
 * The same questions, raw Jev question JSON, over many files. One call per file, every question in each, all in parallel with a cap. Answers come back per path. No file enters the agent's context.
 */
import { jev } from "../../core/client.ts";
import { validateQuestions, type Answer, type Questions, type State } from "../../core/types.ts";
import { FileStateError, readFileState } from "../level08/read-state.ts";
import { expandPatterns, pruneFiles, type Skipped } from "./prune.ts";

export type Decide = (state: State, questions: Questions) => Promise<{ answers: Record<string, Answer>; usage?: unknown }>;

export interface FileAnswers {
  path: string;
  answers: Record<string, Answer>;
  usage?: unknown;
}

export interface AskFilesResult {
  results: FileAnswers[];
  skipped: Skipped[];
  calls: number;
}

/** The agent writes Jev's question shape as JSON. Malformed blocks fail here, with the reason, before any file is read. */
export function parseQuestions(questionsJson: string): Questions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(questionsJson);
  } catch (err: any) {
    throw new Error(`questions_json is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("questions_json must be an object keyed by question id");
  validateQuestions(parsed as Questions);
  return parsed as Questions;
}

/** Run `fn` over `items` with at most `limit` in flight. Results keep the input order. */
export async function parallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function askFiles(
  patterns: string[],
  questionsJson: string,
  cwd: string,
  opts: { recursive?: boolean; concurrency?: number; decide?: Decide; onResult?: (r: FileAnswers) => void } = {},
): Promise<AskFilesResult> {
  const questions = parseQuestions(questionsJson);
  const decide = opts.decide ?? ((s, q) => jev.systemOne(s, q));
  const expanded = await expandPatterns(patterns, cwd, opts.recursive ?? false);
  const { files, skipped } = await pruneFiles(expanded, cwd);
  const results: FileAnswers[] = [];
  await parallel(files, opts.concurrency ?? 16, async (path) => {
    try {
      const state = await readFileState(path, cwd);
      const { answers, usage } = await decide(state, questions);
      const r = { path, answers, usage };
      results.push(r);
      opts.onResult?.(r);
    } catch (err: any) {
      skipped.push({ path, reason: err instanceof FileStateError ? err.message : `call failed: ${err?.message ?? err}` });
    }
  });
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { results, skipped, calls: results.length };
}
