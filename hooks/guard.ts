/**
 * Level 6: guardrail hooks. Claude never calls Jev here; the hooks do.
 *
 *   PreToolUse  Bash         gateBashCommand: deny irreversible or destructive commands
 *   PreToolUse  Write|Edit   gateWriteCall: deny paths outside the project and content holding credentials
 *   PostToolUse Read|Bash    screenToolResult: add a warning when output carries instructions aimed at Claude
 *
 * Fails open: if Jev errors or is slow, the tool call goes ahead and the error is logged.
 * JEV_GUARD=off disables everything; JEV_GATES=A,B,C picks which gates run (default all).
 */
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { level, log, readStdin, textOf, withTimeout } from "../lib/jev.ts";

const gates = (process.env.JEV_GATES ?? "A,B,C").split(",").map((s) => s.trim().toUpperCase());

const within = (path: string, dir: string) => {
  const rel = relative(resolve(dir), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Claude Code writes its own files outside the project. Those skip the path check. */
function harnessPath(path: string, input: any): boolean {
  return within(path, join(homedir(), ".claude")) || (!!input.scratchpad_dir && within(path, input.scratchpad_dir));
}

/** The text an Edit or Write adds. Field names differ between tools and versions; take whatever is there. */
function newText(ti: any): string {
  if (typeof ti.content === "string") return ti.content;
  if (typeof ti.new_string === "string") return ti.new_string;
  if (Array.isArray(ti.edits)) return ti.edits.map((e: any) => e.new_string ?? e.with ?? "").join("\n");
  return "";
}

const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

async function preToolUse(input: any) {
  const L6 = await level("level06/index.ts");
  const cwd = input.cwd ?? process.cwd();
  const ti = input.tool_input ?? {};

  if (input.tool_name === "Bash" && gates.includes("A")) {
    const command = String(ti.command ?? "");
    const d = await withTimeout(L6.gateBashCommand(command, cwd));
    await log({ hook: "PreToolUse", tool: "Bash", command, ...d });
    if (d.block) return deny(`jev-guard blocked this command: ${d.reason}. ${L6.BLOCK_NOTICE}`);
  }

  if ((input.tool_name === "Write" || input.tool_name === "Edit") && gates.includes("B")) {
    const path = String(ti.file_path ?? ti.path ?? "");
    const content = newText(ti);
    // The repo blocks anything outside the project. Claude Code's own memory and scratchpad are exempt from that,
    // but their content is still screened for credentials, so the check runs against the path's own directory.
    const repo = harnessPath(path, input) ? resolve(path, "..") : cwd;
    const d = await withTimeout(L6.gateWriteCall(path, content, repo));
    await log({ hook: "PreToolUse", tool: input.tool_name, path, ...d });
    if (d.block) return deny(`jev-guard blocked this ${input.tool_name}: ${d.reason}. ${L6.BLOCK_NOTICE}`);
  }
  return null;
}

async function postToolUse(input: any) {
  if (!gates.includes("C")) return null;
  const L6 = await level("level06/index.ts");
  const text = textOf(input.tool_response ?? input.tool_output);
  const d = await withTimeout(L6.screenToolResult(input.tool_name, text));
  await log({ hook: "PostToolUse", tool: input.tool_name, flag: d.flag, noul: d.noul });
  // Claude Code cannot rewrite a built-in tool's output, so the banner rides alongside it instead of on top.
  if (d.flag && d.banner) return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `${d.banner} (applies to the ${input.tool_name} result just returned)` } };
  return null;
}

async function main() {
  if (process.env.JEV_GUARD === "off") return;
  const input = await readStdin();
  try {
    const out = input.hook_event_name === "PreToolUse" ? await preToolUse(input)
      : input.hook_event_name === "PostToolUse" ? await postToolUse(input)
      : null;
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (err: any) {
    await log({ hook: input.hook_event_name, tool: input.tool_name, error: err?.message ?? String(err) });
  }
}

await main();
