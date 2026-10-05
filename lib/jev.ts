/**
 * Shared setup: credentials, the path to the ten-levels code, and a fail-open timeout.
 *
 * The level logic is imported from the cloned repo, not copied, so `git pull` there picks up fixes.
 * Credentials: OPENROUTER_API_KEY from the environment, else ~/.config/jev/openrouter_key.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const REPO = process.env.JEV_REPO ?? join(homedir(), "dev/ten-levels-of-jev/apps/ten-levels");
const KEY_FILE = process.env.JEV_KEY_FILE ?? join(homedir(), ".config/jev/openrouter_key");

/** Load the key file if no key is set yet. Called per call, so a long-lived MCP server picks up a key created after it started. */
export function ensureKey(): void {
  if (!process.env.OPENROUTER_API_KEY && !process.env.TYPESAFE_API_KEY && !process.env.JEV_BACKEND && existsSync(KEY_FILE)) {
    process.env.OPENROUTER_API_KEY = readFileSync(KEY_FILE, "utf8").trim();
  }
}
ensureKey();

/** Import a module from the ten-levels repo, e.g. level("level06/index.ts"). */
export const level = (rel: string) => import(join(REPO, "src/levels", rel));

/** Import a module from the repo's core, e.g. core("helpers.ts"). */
export const core = (rel: string) => import(join(REPO, "src/core", rel));

/** Hooks must never hang the session. Past the deadline the hook gives up and allows. */
export function withTimeout<T>(p: Promise<T>, ms = Number(process.env.JEV_HOOK_TIMEOUT_MS ?? 5000)): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`jev timed out after ${ms}ms`)), ms).unref())]);
}

export async function readStdin(): Promise<any> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim() ? JSON.parse(raw) : {};
}

/** Every string inside a value, joined. Tool responses differ by tool; this reads them all the same way. */
export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join("\n");
  if (v && typeof v === "object") return Object.values(v).map(textOf).filter(Boolean).join("\n");
  return "";
}

/** Append one line to the decision log, so blocks and flags can be audited later. */
export async function log(entry: Record<string, unknown>) {
  const file = process.env.JEV_LOG ?? join(homedir(), ".cache/jev-claude/decisions.jsonl");
  try {
    const { mkdir, appendFile } = await import("node:fs/promises");
    await mkdir(join(file, ".."), { recursive: true });
    await appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

/** The repo's shared client. Lazy: provider and key resolve on the first call. */
export async function systemOne(state: unknown, questions: unknown): Promise<{ answers: any; usage?: unknown }> {
  ensureKey();
  const { jev } = await import(join(REPO, "src/core/client.ts"));
  return jev.systemOne(state, questions);
}
