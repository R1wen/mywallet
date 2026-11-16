#!/usr/bin/env node
// Stop: if TypeScript files changed, run the typecheck and the fast domain unit tests.
// On failure, block the stop (exit 2) so Claude fixes the problem before finishing.
import { spawnSync } from "node:child_process";
import { pnpm, projectDir, readStdin, tail } from "./lib.mjs";

const input = await readStdin();
if (input.stop_hook_active) process.exit(0);

// --untracked-files=all : un nouveau dossier apparaît sinon comme `?? dir/` sans ses fichiers.
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
  cwd: projectDir(),
  encoding: "utf8",
});
const changedTs = (status.stdout ?? "")
  .split(/\r?\n/)
  .some((l) => /\.(ts|tsx)"?$/.test(l.trim()) && !/\.claude\//.test(l));
if (!changedTs) process.exit(0);

// `pnpm typecheck` = next typegen + tsc (types globaux LayoutProps/PageProps).
const tsc = pnpm(["typecheck"], { timeoutMs: 240_000 });
if (!tsc.ok) {
  process.stderr.write(
    `Typecheck en échec, corriger avant de terminer :\n${tail(tsc.output, 30)}\n`,
  );
  process.exit(2);
}

// Via le script `test` : `pnpm exec vitest` plante (« reading 'config' ») avec Vitest 5 + projects.
const tests = pnpm(["test", "src/lib/domain"], {
  timeoutMs: 180_000,
});
if (!tests.ok) {
  process.stderr.write(
    `Tests du domaine en échec, corriger avant de terminer :\n${tail(tests.output, 40)}\n`,
  );
  process.exit(2);
}

process.exit(0);
