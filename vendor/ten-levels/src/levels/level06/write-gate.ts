/**
 * Level 6, option B: write gate.
 * Before any write or edit: paths are checked in code, content is judged by Jev. Outside the repo blocks without a call. Inside, one call asks whether the file or its content holds credentials.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { jev } from "../../core/client.ts";
import { choice, noul } from "../../core/helpers.ts";
import type { ChoiceAnswer, NoulAnswer, Questions, State } from "../../core/types.ts";
import type { Decide, GateDecision } from "./bash-gate.ts";

export const WRITE_QUESTIONS = {
  kind: choice("What kind of file is `path`, given `content`?", {
    source_code: "Application code, tests, scripts",
    config: "Settings, build config, CI, package manifests",
    secrets: "Credentials, API keys, tokens, private keys, or a file whose job is to hold them",
    docs: "Markdown, notes, licenses, changelogs",
    data: "Fixtures, migrations, seeds, exports",
  }),
  contains_secret: noul("Does `content` contain a real credential, not a placeholder?", {
    true: "A key, token, password, or connection string with what looks like a real value",
    false: "Placeholders like replace-me or xxx, empty values, or no credentials at all",
  }),
};

export interface WriteGateAnswers {
  kind: ChoiceAnswer;
  contains_secret: NoulAnswer;
}

export const WRITE_THRESHOLDS = { secret: 0.7 };

/** Paths stay in code: anything that resolves outside the repo is blocked before Jev is asked. */
export function insideRepo(path: string, repo: string): boolean {
  const target = isAbsolute(path) ? path : resolve(repo, path);
  const rel = relative(resolve(repo), target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function gateWrite(a: WriteGateAnswers, secretFloor = WRITE_THRESHOLDS.secret): GateDecision {
  if (a.contains_secret.noul >= secretFloor) {
    return { block: true, reason: `contains a credential (${a.contains_secret.noul.toFixed(2)}): write it to an ignored .env or a secret store, not the repo` };
  }
  if (a.kind.choice === "secrets" && a.kind.confidence >= 0.8) {
    return { block: true, reason: `a secrets file (${a.kind.confidence.toFixed(2)}): keep credentials out of the repo` };
  }
  return { block: false, reason: `${a.kind.choice} (${a.kind.confidence.toFixed(2)}), secret ${a.contains_secret.noul.toFixed(2)}` };
}

/** B: code decides on the path, Jev on the content. Content is trimmed so a big file does not blow the budget. */
export async function gateWriteCall(path: string, content: string, repo: string, decide: Decide = (s, q) => jev.systemOne(s, q)): Promise<GateDecision> {
  if (!insideRepo(path, repo)) return { block: true, reason: `outside the repo: ${path}` };
  const state: State = { path, content: content.length > 4000 ? content.slice(0, 4000) + "\n…" : content };
  const { answers } = await decide(state, WRITE_QUESTIONS as Questions);
  return gateWrite(answers as unknown as WriteGateAnswers);
}
