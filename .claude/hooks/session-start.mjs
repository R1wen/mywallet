#!/usr/bin/env node
// SessionStart: inject the sprint table of docs/ROADMAP.md into Claude's context.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectDir } from "./lib.mjs";

let roadmap = "";
try {
  roadmap = await readFile(path.join(projectDir(), "docs", "ROADMAP.md"), "utf8");
} catch {
  process.exit(0);
}

const current = roadmap.split(/\r?\n## /)[0].trim();
const inProgress = roadmap
  .split(/\r?\n/)
  .filter((l) => /^- \[[ ~]\]/.test(l))
  .slice(0, 15)
  .join("\n");

const context = `État de docs/ROADMAP.md au démarrage de la session :\n\n${current}\n\nTâches ouvertes :\n${inProgress}`;
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context.slice(0, 9000),
    },
  }),
);
