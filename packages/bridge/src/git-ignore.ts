import fs from "node:fs";
import path from "node:path";

const IGNORE_ENTRY = ".tapmakerwork/";
const EXISTING_RULE = /^\/?\.tapmakerwork(\/(\*\*?)?)?$/;

export interface GitIgnoreResult {
  gitignorePath: string;
  changed: boolean;
}

export function ensureTapMakerWorkGitIgnored(projectRoot: string): GitIgnoreResult {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const alreadyIgnored = current.split(/\r?\n/).some((line) => EXISTING_RULE.test(line.trim()));
  if (alreadyIgnored) return { gitignorePath, changed: false };

  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const lead = !current ? "" : current.endsWith("\n") ? eol : `${eol}${eol}`;
  const block = `# TapMakerWork IDE local state${eol}${IGNORE_ENTRY}${eol}`;
  fs.writeFileSync(gitignorePath, `${current}${lead}${block}`, "utf8");
  return { gitignorePath, changed: true };
}
