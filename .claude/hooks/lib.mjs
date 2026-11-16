// Shared helpers for project hooks (Node, portable Windows/macOS/Linux).
import { spawnSync } from "node:child_process";

export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** PreToolUse: deny the tool call with a reason shown to Claude. */
export function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

export function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** Runs a pnpm command in the project, returns { ok, output }. */
export function pnpm(args, { timeoutMs = 120_000 } = {}) {
  const isWin = process.platform === "win32";
  const res = spawnSync(isWin ? "pnpm.cmd" : "pnpm", args, {
    cwd: projectDir(),
    encoding: "utf8",
    timeout: timeoutMs,
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return { ok: res.status === 0, output };
}

export function tail(text, lines = 40) {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}
