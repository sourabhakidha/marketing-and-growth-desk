#!/usr/bin/env node
// Guards the shared Supabase project: migrations in this repo may only touch
// the marketing_os / marketing_os_private schemas. Run in CI on every change.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OWN = new Set(["marketing_os", "marketing_os_private"]);
// References allowed outside our schemas (read-only dependencies)
const ALLOWED_QUALIFIED = new Set(["auth.uid", "auth.users"]);
const SQL_FUNCS_LIKE_QUALIFIED = new Set(["new", "old", "m", "excluded", "tg"]); // aliases / trigger records

export function stripSql(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, (body) => body.replace(/'[^']*'/g, "''")) // keep function bodies, drop literals
    .replace(/'(?:[^']|'')*'/g, "''");
}

export function findViolations(sql) {
  const text = stripSql(sql).toLowerCase();
  const problems = [];

  for (const match of text.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
    const [full, schema] = match;
    if (OWN.has(schema) || ALLOWED_QUALIFIED.has(full) || SQL_FUNCS_LIKE_QUALIFIED.has(schema)) continue;
    problems.push(`references ${full} (outside marketing_os)`);
  }

  const rules = [
    [/\balter\s+default\s+privileges\b(?![^;]*\bin\s+schema\s+marketing_os(_private)?\b)/, "ALTER DEFAULT PRIVILEGES without IN SCHEMA marketing_os"],
    [/\bon\s+all\s+(tables|functions|sequences)\s+in\s+schema\s+(?!marketing_os(_private)?\b)/, "bulk GRANT/REVOKE on another schema"],
    [/\b(create|alter|drop)\s+(role|user|publication|subscription|event\s+trigger|extension|database)\b/, "project-wide object (role/extension/publication/…)"],
    [/\balter\s+system\b/, "ALTER SYSTEM"],
    [/\bsearch_path\s*=(?!\s*'')/, "non-empty search_path (functions must use set search_path = '')"],
    [/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/, "GRANT to anon/public"],
    [/\bdisable\s+row\s+level\s+security\b/, "disables RLS"],
  ];
  for (const [re, label] of rules) if (re.test(text)) problems.push(label);

  // Every table created must have RLS enabled AND forced in the same migration
  for (const m of text.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_]+)/g)) {
    const table = m[1].replace(/[.]/g, "\\.");
    if (!new RegExp(`alter\\s+table\\s+${table}\\s+enable\\s+row\\s+level\\s+security`).test(text))
      problems.push(`${m[1]} has no ENABLE ROW LEVEL SECURITY`);
    if (!new RegExp(`alter\\s+table\\s+${table}\\s+force\\s+row\\s+level\\s+security`).test(text))
      problems.push(`${m[1]} has no FORCE ROW LEVEL SECURITY`);
  }
  return [...new Set(problems)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(fileURLToPath(new URL("..", import.meta.url)), "supabase", "migrations");
  let failed = false;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const problems = findViolations(readFileSync(join(dir, file), "utf8"));
    if (problems.length) {
      failed = true;
      console.error(`✗ ${file}`);
      for (const p of problems) console.error(`   - ${p}`);
    } else console.log(`✓ ${file}`);
  }
  if (failed) {
    console.error("\nMigration guard failed: this repo may only change the marketing_os schemas.");
    process.exit(1);
  }
}
