#!/usr/bin/env node
// Adds a person to Marketing OS. Run LOCALLY by an admin (never in Netlify/CI):
//
//   npm run member:create -- --username priya --name "Priya" --role contributor
//   npm run member:create -- --username priya --reset-password
//   npm run member:create -- --username priya --deactivate
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
// People sign in with username + password (decision D-008). Each account gets
// its own random password, printed ONCE here. Share it privately; the person
// changes it under Account after first sign-in.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "contributor" },
    deactivate: { type: "boolean", default: false },
    "reset-password": { type: "boolean", default: false },
  },
});

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const username = values.username?.trim().toLowerCase();
const name = values.name?.trim();
const role = values.role;
if (!username || !/^[a-z][a-z0-9_.-]{1,29}$/.test(username)) fail("--username is required (lowercase letters, digits, . _ -)");
const email = `${username}@marketing-os.invalid`; // internal login address, never used for mail
const maintenance = values.deactivate || values["reset-password"];
if (!maintenance && !name) fail("--name is required");
if (!["admin", "contributor"].includes(role)) fail("--role must be admin or contributor");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.startsWith("https://") || !serviceKey) {
  fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example)");
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);
const db = createClient(url, serviceKey, { ...opts, db: { schema: "marketing_os" } });

async function findAuthUser(target) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Could not list auth users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const { data: existingMember, error: memberLookupError } = await db
  .from("members").select("id, user_id, role, is_active").eq("username", username).maybeSingle();
if (memberLookupError) fail(`Could not read marketing_os.members: ${memberLookupError.message}`);

if (values.deactivate) {
  if (!existingMember) fail(`${username} is not a Marketing OS member`);
  const { error } = await db.from("members").update({ is_active: false }).eq("id", existingMember.id);
  if (error) fail(error.message);
  console.log(`✓ ${username} deactivated`);
  process.exit(0);
}

const newPassword = () => randomBytes(18).toString("base64url"); // 24 chars, unique per person

if (values["reset-password"]) {
  if (!existingMember?.user_id) fail(`${username} is not a Marketing OS member with a login`);
  const password = newPassword();
  const { error } = await admin.auth.admin.updateUserById(existingMember.user_id, { password });
  if (error) fail(error.message);
  console.log(`✓ New password for ${username} (shown once — share privately):\n\n    ${password}\n`);
  process.exit(0);
}

let user = await findAuthUser(email);
let temporaryPassword = null;

if (!user) {
  temporaryPassword = newPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) fail(`Could not create account: ${error.message}`);
  user = data.user;
}

const row = { user_id: user.id, username, email, display_name: name, role, is_active: true };
const { error: writeError } = existingMember
  ? await db.from("members").update(row).eq("id", existingMember.id)
  : await db.from("members").insert(row);
if (writeError) fail(`Could not save membership: ${writeError.message}`);

console.log(`✓ ${name} (username: ${username}) is a Marketing OS ${role}`);
if (temporaryPassword) {
  console.log("\n  Temporary password (shown once — share privately, e.g. in person or a password manager):");
  console.log(`\n    ${temporaryPassword}\n`);
  console.log("  Ask them to change it under Account after their first sign-in.");
} else {
  console.log("  Login already existed: password unchanged (use --reset-password to issue a new one).");
}
