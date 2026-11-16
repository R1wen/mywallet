#!/usr/bin/env node
// PreToolUse guard: blocks access to .env* / secret files and destructive recursive deletes
// outside build folders. Reads the hook payload on stdin, answers with a JSON decision.
import { readStdin, deny } from "./lib.mjs";

const ALLOWED_RM_TARGETS = new Set([
  ".next",
  "node_modules",
  "coverage",
  "dist",
  "out",
  "build",
  "playwright-report",
  "test-results",
  "blob-report",
  ".turbo",
  "storage/tmp",
]);

// `.env`, `.env.local`, `.env.production`… but not `.env.example`.
// Le lookahead inclut les jokers (`.env*`, `.env?`, `.env[…]`, `.env{…}`).
const ENV_FILE = /(^|[\s"'`=/\\:(])\.env(?!\.example\b)(\.[\w.-]+)?(?=$|[\s"'`/\\);|&>*?[{])/;
const SECRET_FILE =
  /(^|[\s"'`=/\\])(id_rsa|id_ed25519|[\w.-]+\.pem|[\w.-]+\.key|credentials\.json|\.credentials\.json|\.npmrc|\.netrc)(?=$|[\s"'`;|&>])/i;

function isSecretPath(p) {
  if (!p) return false;
  const name = p.replace(/\\/g, "/").split("/").pop() ?? "";
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") return true;
  return /^(id_rsa|id_ed25519|.*\.pem|.*\.key|credentials\.json|\.credentials\.json|\.npmrc|\.netrc)$/i.test(
    name,
  );
}

function normalizeTarget(t) {
  return t
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function checkRecursiveDelete(command) {
  // bash: rm -rf / rm -r -f / rm --recursive ; PowerShell: Remove-Item -Recurse
  const bashRm = /\brm\s+((?:-{1,2}[\w-]+\s+)+)([^;&|\n]+)/g;
  for (const m of command.matchAll(bashRm)) {
    const flags = m[1];
    if (!/(^|\s)-[a-zA-Z]*r|--recursive/.test(flags)) continue;
    const targets = m[2].trim().split(/\s+/).map(normalizeTarget);
    const bad = targets.filter((t) => !ALLOWED_RM_TARGETS.has(t));
    if (bad.length) return `rm récursif bloqué hors dossiers de build : ${bad.join(", ")}`;
  }
  const psRm = /\b(Remove-Item|rm|rd|rmdir|del)\b([^;|\n]*-Recurse[^;|\n]*)/gi;
  for (const m of command.matchAll(psRm)) {
    const args = m[2]
      .replace(/-(Recurse|Force|Confirm:\$false|ErrorAction\s+\w+)/gi, " ")
      .replace(/-(Path|LiteralPath)\s+/gi, " ")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(normalizeTarget);
    const bad = args.filter((t) => !ALLOWED_RM_TARGETS.has(t));
    if (bad.length)
      return `suppression récursive bloquée hors dossiers de build : ${bad.join(", ")}`;
  }
  return null;
}

const input = await readStdin();
const tool = input.tool_name ?? "";
const ti = input.tool_input ?? {};

if (tool === "Bash" || tool === "PowerShell") {
  const command = String(ti.command ?? "");
  if (ENV_FILE.test(command) || SECRET_FILE.test(command)) {
    deny("Accès aux fichiers .env / secrets bloqué par le hook du projet. Utiliser .env.example.");
  }
  const rmReason = checkRecursiveDelete(command);
  if (rmReason) deny(rmReason);
} else if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const p = String(ti.file_path ?? ti.notebook_path ?? "");
  if (isSecretPath(p)) {
    deny(`Accès à ${p} bloqué par le hook du projet (.env et fichiers de secrets).`);
  }
} else if (tool === "Grep" || tool === "Glob") {
  // Grep : on regarde le chemin et le filtre de fichiers (pas le motif de recherche, qui est du texte).
  const targets = tool === "Grep" ? [ti.path, ti.glob] : [ti.path, ti.pattern];
  const p = targets.map((t) => String(t ?? "")).join(" ");
  if (/\.env(?!\.example\b)/.test(p) || isSecretPath(String(ti.path ?? ""))) {
    deny("Recherche ciblant des fichiers .env bloquée par le hook du projet.");
  }
}

process.exit(0);
