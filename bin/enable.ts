/**
 * Turn the level 5, 6 and 7 hooks on or off for one project, in its .claude/settings.local.json.
 * Local, not settings.json: the commands are absolute paths on this machine, so they should not be committed.
 *
 *   node bin/enable.ts <project-dir>         add the hooks (idempotent)
 *   node bin/enable.ts <project-dir> --off   remove them, leaving other hooks alone
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dirname, "..");
const guard = `node ${join(HERE, "hooks/guard.ts")}`;
const prompt = `node ${join(HERE, "hooks/prompt.ts")}`;
// hooks/compact.ts was the UserPromptSubmit entry before prompt.ts; listed so re-running cleans it up.
const OURS = [guard, prompt, `node ${join(HERE, "hooks/compact.ts")}`];

const WANT: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[]> = {
  PreToolUse: [{ matcher: "Bash|Write|Edit", hooks: [{ type: "command", command: guard, timeout: 10 }] }],
  PostToolUse: [{ matcher: "Read|Bash", hooks: [{ type: "command", command: guard, timeout: 10 }] }],
  UserPromptSubmit: [{ hooks: [{ type: "command", command: prompt, timeout: 15 }] }],
};

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error("usage: node bin/enable.ts <project-dir> [--off]"); process.exit(1); }
const file = join(resolve(dir), ".claude/settings.local.json");
const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
settings.hooks ??= {};

// Remove ours first, from every event, so re-running never duplicates.
for (const event of Object.keys(settings.hooks)) {
  settings.hooks[event] = settings.hooks[event]
    .map((g: any) => ({ ...g, hooks: g.hooks.filter((h: any) => !OURS.includes(h.command)) }))
    .filter((g: any) => g.hooks.length > 0);
  if (settings.hooks[event].length === 0) delete settings.hooks[event];
}
if (flag !== "--off") for (const [event, groups] of Object.entries(WANT)) (settings.hooks[event] ??= []).push(...groups);
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

mkdirSync(join(resolve(dir), ".claude"), { recursive: true });
writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");

// Keep it out of git without editing the project's .gitignore.
const exclude = join(resolve(dir), ".git/info/exclude");
if (existsSync(join(resolve(dir), ".git")) && !(existsSync(exclude) && readFileSync(exclude, "utf8").split("\n").includes(".claude/settings.local.json"))) {
  mkdirSync(join(exclude, ".."), { recursive: true });
  writeFileSync(exclude, (existsSync(exclude) ? readFileSync(exclude, "utf8").replace(/\n?$/, "\n") : "") + ".claude/settings.local.json\n");
}
console.log(`${flag === "--off" ? "removed jev hooks from" : "jev hooks on in"} ${file}`);
