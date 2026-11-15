#!/usr/bin/env node
// Stop: if TypeScript files changed, run the typecheck and the fast domain unit tests.
// On failure, block the stop (exit 2) so Claude fixes the problem before finishing.
import { spawnSync } from "node:child_process";
import { pnpm, projectDir, readStdin, tail } from "./lib.mjs";

const input = await readStdin();
if (input.stop_hook_active) process.exit(0);

const status = spawnSync("git", ["status", "--porcelain"], { cwd: projectDir(), encoding: "utf8" });
const changedTs = (status.stdout ?? "")
  .split(/\r?\n/)
  .some((l) => /\.(ts|tsx)"?$/.test(l.trim()) && !/\.claude\//.test(l));
if (!changedTs) process.exit(0);

const tsc = pnpm(["exec", "tsc", "--noEmit"], { timeoutMs: 180_000 });
if (!tsc.ok) {
  process.stderr.write(
    `Typecheck en échec, corriger avant de terminer :\n${tail(tsc.output, 30)}\n`,
  );
  process.exit(2);
}

const tests = pnpm(["exec", "vitest", "run", "--project", "unit", "src/lib/domain"], {
  timeoutMs: 180_000,
});
if (!tests.ok) {
  process.stderr.write(
    `Tests du domaine en échec, corriger avant de terminer :\n${tail(tests.output, 40)}\n`,
  );
  process.exit(2);
}

process.exit(0);
