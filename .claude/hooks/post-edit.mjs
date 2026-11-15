#!/usr/bin/env node
// PostToolUse (Edit|Write): format the edited file with Prettier and lint it with ESLint.
// Lint errors are fed back to Claude (exit 2) so they get fixed right away.
import path from "node:path";
import { pnpm, projectDir, readStdin, tail } from "./lib.mjs";

const input = await readStdin();
const file = input.tool_input?.file_path;
if (!file) process.exit(0);

const rel = path.relative(projectDir(), file).replace(/\\/g, "/");
if (rel.startsWith("..") || /(^|\/)(node_modules|\.next|drizzle\/meta|docs\/screens)\//.test(rel)) {
  process.exit(0);
}

const prettierExt = /\.(ts|tsx|js|mjs|cjs|json|css|md|yml|yaml)$/;
const lintExt = /\.(ts|tsx|js|mjs|cjs)$/;

if (prettierExt.test(rel)) {
  pnpm(["exec", "prettier", "--write", "--log-level", "warn", rel], { timeoutMs: 30_000 });
}

if (lintExt.test(rel) && !rel.startsWith(".claude/")) {
  const { ok, output } = pnpm(["exec", "eslint", "--fix", "--max-warnings=0", rel], {
    timeoutMs: 60_000,
  });
  if (!ok) {
    process.stderr.write(`ESLint a signalé des problèmes dans ${rel} :\n${tail(output, 30)}\n`);
    process.exit(2);
  }
}

process.exit(0);
