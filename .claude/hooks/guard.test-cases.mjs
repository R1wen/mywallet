#!/usr/bin/env node
// Cas de test du hook guard.mjs : `node .claude/hooks/guard.test-cases.mjs`.
// Les noms de fichiers sensibles sont construits dynamiquement pour ne pas déclencher le hook
// sur la commande qui lance ce script.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./guard.mjs", import.meta.url));
const E = "." + "env";
const cases = [
  [{ tool_name: "Bash", tool_input: { command: `cat ${E}.local` } }, "deny"],
  [{ tool_name: "Bash", tool_input: { command: `cat ${E}*` } }, "deny"],
  [{ tool_name: "Bash", tool_input: { command: `cp ${E}.example ${E}` } }, "deny"],
  [{ tool_name: "Bash", tool_input: { command: `cat ${E}.example` } }, "allow"],
  [{ tool_name: "Bash", tool_input: { command: `node -e "process${E}.X"` } }, "allow"],
  [{ tool_name: "Bash", tool_input: { command: "rm -rf .next coverage" } }, "allow"],
  [{ tool_name: "Bash", tool_input: { command: "rm -rf src" } }, "deny"],
  [{ tool_name: "Bash", tool_input: { command: "rm -r -f ./" } }, "deny"],
  [{ tool_name: "Bash", tool_input: { command: "git rm -q src/app/page.tsx" } }, "allow"],
  [
    {
      tool_name: "PowerShell",
      tool_input: { command: "Remove-Item -Recurse -Force node_modules -Confirm:$false" },
    },
    "allow",
  ],
  [
    { tool_name: "PowerShell", tool_input: { command: "Remove-Item -Recurse -Force C:\\Users" } },
    "deny",
  ],
  [{ tool_name: "Read", tool_input: { file_path: `C:\\x\\${E}.production` } }, "deny"],
  [{ tool_name: "Read", tool_input: { file_path: `C:\\x\\${E}.example` } }, "allow"],
  [{ tool_name: "Write", tool_input: { file_path: "C:\\x\\src\\env.ts" } }, "allow"],
  [{ tool_name: "Read", tool_input: { file_path: "C:\\x\\server.pem" } }, "deny"],
  [{ tool_name: "Grep", tool_input: { pattern: ".", path: `C:\\x\\${E}.local` } }, "deny"],
  [{ tool_name: "Grep", tool_input: { pattern: "SECRET", glob: `${E}*` } }, "deny"],
  [{ tool_name: "Grep", tool_input: { pattern: `process${E}`, path: "src" } }, "allow"],
  [{ tool_name: "Glob", tool_input: { pattern: `**/${E}*` } }, "deny"],
  [{ tool_name: "Glob", tool_input: { pattern: "src/**/*.ts" } }, "allow"],
];

let fail = 0;
for (const [payload, expected] of cases) {
  const r = spawnSync("node", [guard], { input: JSON.stringify(payload), encoding: "utf8" });
  const got = r.stdout.includes('"deny"') ? "deny" : "allow";
  if (got !== expected) fail++;
  console.log(
    got === expected ? "ok  " : "FAIL",
    expected.padEnd(5),
    JSON.stringify(payload.tool_input).slice(0, 80),
  );
}
console.log(fail ? `${fail} échec(s)` : "tous les cas passent");
process.exit(fail ? 1 : 0);
