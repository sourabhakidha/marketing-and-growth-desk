#!/usr/bin/env node
// Fails if anything that looks like a real secret is present in tracked or
// staged files. Complements (does not replace) GitHub secret scanning.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  [/sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/, "OpenAI API key"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT (possibly a Supabase key)"],
  [/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@/, "database URL with password"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
];

const SKIP = [/^package-lock\.json$/, /\.(png|jpe?g|gif|ico|woff2?|pdf|docx)$/i, /^scripts\/check-secrets\.mjs$/];

let files;
try {
  files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
} catch {
  console.error("check-secrets: not a git repository");
  process.exit(1);
}

const findings = [];
for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;
  if (/^\.env(\.|$)/.test(file) && file !== ".env.example") findings.push(`${file}: environment file must not be committed`);
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    for (const [re, label] of PATTERNS) if (re.test(line)) findings.push(`${file}:${i + 1}: ${label}`);
  });
}

if (findings.length) {
  console.error("Possible secrets found (values not shown):");
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}
console.log(`check-secrets: ${files.length} files scanned, no secrets found`);
