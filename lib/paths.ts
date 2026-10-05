/** Path rules for the MCP tools: inside the project, and not a likely secrets file. */
import { realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const SECRET = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa|dsa)|credentials(\.json)?|\.netrc|\.npmrc|\.pypirc)$/i;

/** Throws unless the path is inside root and does not look like a secret. Symlinks are resolved first. */
export function checkPathIn(path: string, root: string): void {
  const full = resolve(root, path);
  let real = full;
  try { real = realpathSync(full); } catch {}
  const rel = relative(realpathSync(root), real);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`outside the project (${root}): ${path}`);
  if (SECRET.test(basename(real))) throw new Error(`refused, looks like a secrets file: ${path}`);
}
