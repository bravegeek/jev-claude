/**
 * Levels 5, 8 and 9 as MCP tools. Code reads the file and sends it to Jev; Claude gets a typed answer, never the file.
 *
 *   ask_jev_file_bool / _choice / _score   level 8, one file
 *   ask_jev_files                          level 9, the same questions over many files in parallel
 *   pick_first_file                        level 9, which of these to open first
 *   route_model                            level 5, which model a subagent should run on
 *
 * Added on top of the repo: paths must resolve inside the project, and likely secret files are refused.
 * MCP tools bypass Claude Code's Read permissions, and the file's text leaves the machine.
 */
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ensureKey, level, systemOne } from "../lib/jev.ts";
import { checkPathIn } from "../lib/paths.ts";
import { routeTask, subagentModel } from "../lib/route.ts";

const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const checkPath = (path: string) => checkPathIn(path, ROOT);

const WHEN =
  "Use this for a judgment about what a file does or contains, without reading it into your context. " +
  "Write the question against `content`, which is the file's text. Use Read instead when you need the code itself, to edit or quote it. " +
  "Exact lookups (does this string appear, how many lines) belong to Grep, not here. The file is sent to an external model.";

const QUESTION_SCHEMA =
  'questions_json is a JSON object keyed by question id. Three types. ' +
  'noul: {"type":"noul","instructions":"Does `content` ...?","criteria":{"true":"...","false":"..."}} returns a probability of yes. ' +
  'choice: {"type":"choice","instructions":"Which ... is `content`?","criteria":{"option_a":"when it applies","option_b":"...","other":"none of the above"}} returns one of your keys plus confidence, up to 255 options. ' +
  'score: {"type":"score","instructions":"How ... is `content`?","criteria":["lowest situation","...","highest situation"]} returns a position on your levels, two to ten of them. ' +
  "Write every question against `content`, the file's text; `path` is also in the state. Ask every question you might need in one block, it is one call per file either way.";

const ok = (payload: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] });
const fail = (err: any) => ({ content: [{ type: "text" as const, text: `error: ${err?.message ?? err}` }], isError: true });
const run = (fn: () => Promise<unknown>) => { ensureKey(); return fn().then(ok, fail); };

const L8 = await level("level08/index.ts");
const L9 = await level("level09/index.ts");
const server = new McpServer({ name: "jev", version: "0.2.0" }, {
  instructions:
    "Before you start a subagent, call route_model with the task you are about to hand it, and pass the returned model " +
    "as the subagent's model parameter. It costs a fraction of a cent and about 300ms. " +
    "The ask_jev_file tools answer typed questions about files without reading them into your context.",
});

server.registerTool("ask_jev_file_bool", {
  description: `Yes or no about one file. Returns { path, answer, noul } where noul is the probability of yes, 0 to 1. ${WHEN}`,
  inputSchema: {
    path: z.string().describe("File path, relative to the project"),
    question: z.string().describe("A yes or no question about `content`, for example: Does `content` validate authentication tokens?"),
    yes: z.string().optional().describe("What counts as yes"),
    no: z.string().optional().describe("What counts as no"),
  },
}, (p) => run(async () => { checkPath(p.path); return L8.askFileBool(p.path, p.question, ROOT, { yes: p.yes, no: p.no }); }));

server.registerTool("ask_jev_file_choice", {
  description: `Pick one option about one file. Returns { path, choice, confidence, probabilities }. The choice is always one of your options; an "other" option is added if you leave none. ${WHEN}`,
  inputSchema: {
    path: z.string().describe("File path, relative to the project"),
    question: z.string().describe("The question, for example: Which layer is `content`?"),
    options: z.record(z.string(), z.string()).describe("Option name to a one line description of when it applies. Up to 255."),
  },
}, (p) => run(async () => { checkPath(p.path); return L8.askFileChoice(p.path, p.question, p.options, ROOT); }));

server.registerTool("ask_jev_file_score", {
  description: `A position on a scale you define, about one file. Returns { path, score, top, nearest, confidence, legend }. Levels are ordered low to high, two to ten of them, each a described situation. ${WHEN}`,
  inputSchema: {
    path: z.string().describe("File path, relative to the project"),
    question: z.string().describe("The question, for example: How risky is a refactor of `content`?"),
    levels: z.array(z.string()).describe("Ordered low to high, each level a situation, for example: Isolated and well tested"),
  },
}, (p) => run(async () => { checkPath(p.path); return L8.askFileScore(p.path, p.question, p.levels, ROOT); }));

server.registerTool("ask_jev_files", {
  description:
    "Ask the same typed questions of many files at once without reading any of them. Code expands globs and directories, " +
    "drops node_modules, .git, binaries, secret files, anything outside the project and files over the budget, caps the list at 255, " +
    "then makes one Jev call per file in parallel. Returns { results: [{ path, answers }], skipped: [{ path, reason }], calls }. " +
    QUESTION_SCHEMA + " Use Read when you need a file's code; use Grep for exact strings. Files are sent to an external model.",
  inputSchema: {
    paths_or_globs: z.array(z.string()).describe('Files, directories, or globs, relative to the project, for example ["src/**/*.ts"] or ["src/http"]'),
    questions_json: z.string().describe("The question block as a JSON string"),
    recursive: z.boolean().optional().describe("For directories: include every file below them. Default false."),
  },
}, (p) => run(async () => {
  // askFiles from the repo, with checkPath between expand and prune. Expanding only once matters:
  // a concrete path like app/[id].ts would be read as a glob if passed back through expandPatterns.
  const questions = L9.parseQuestions(p.questions_json);
  const expanded: string[] = await L9.expandPatterns(p.paths_or_globs, ROOT, p.recursive ?? false);
  const skipped: { path: string; reason: string }[] = [];
  const allowed = expanded.filter((f) => { try { checkPath(f); return true; } catch (e: any) { skipped.push({ path: f, reason: e.message }); return false; } });
  const pruned = await L9.pruneFiles(allowed, ROOT);
  skipped.push(...pruned.skipped);
  const results: { path: string; answers: unknown }[] = [];
  await L9.parallel(pruned.files, 16, async (path: string) => {
    try {
      const { answers } = await systemOne(await L8.readFileState(path, ROOT), questions);
      results.push({ path, answers });
    } catch (err: any) {
      skipped.push({ path, reason: err instanceof L8.FileStateError ? err.message : `call failed: ${err?.message ?? err}` });
    }
  });
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { results, skipped, calls: results.length };
}));

server.registerTool("pick_first_file", {
  description:
    "After ask_jev_files, choose which of a list of files to open first for a goal. One Choice keyed by path, so the pick is always a real file. " +
    "Returns { path | null, confidence, probabilities }. Pass a short note per path if you have one, for example the answers you already got. Files are not read.",
  inputSchema: {
    question: z.string().describe("The goal, for example: Which file should I open first to fix the proration bug?"),
    candidates: z.array(z.object({ path: z.string(), note: z.string().optional() })).describe("Paths, with an optional one line note each"),
  },
}, (p) => run(() => L9.pickFirstFile(p.question, p.candidates)));

server.registerTool("route_model", {
  description:
    "Level 5 model router. Call it before starting a subagent: pass the task you are about to delegate, then use the returned " +
    "model (haiku, sonnet or opus) as the subagent's model. Returns { model, tier, rationale }. " +
    "Mechanical edits and simple lookups get haiku; ordinary coding and investigation get sonnet; design, hard debugging " +
    "and high-stakes reviews get opus. When unsure it returns sonnet.",
  inputSchema: { task: z.string().describe("The task as you would brief the subagent, in a sentence or two") },
}, (p) => run(async () => {
  const r = await routeTask(p.task, 10_000);
  return { model: subagentModel(r), tier: r.tier, rationale: r.rationale };
}));

await server.connect(new StdioServerTransport());
