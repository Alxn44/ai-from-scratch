#!/usr/bin/env node
/**
 * Does any live account use a password that has been published in this repository?
 *
 * WHY THIS EXISTS
 * `Curso2026*` is printed in `api/README.md` as the password for three seeded
 * accounts, one of them an `admin`. The seed no longer creates them — demo users
 * need `SEED_DEMO_USERS=1` plus an explicit `SEED_DEMO_PASSWORD`, and are refused
 * outright under `NODE_ENV=production` — but that only stops NEW databases. Any
 * database seeded before that fix still holds those rows, and an admin whose
 * password is in a git repository is an admin anyone who can read the repo can
 * become.
 *
 * Enumerating placeholders in `auth.ts` protects the SIGNING KEY. Nothing was
 * checking the other direction: whether a real user row is unlocked by a string
 * we published. This does, against whatever database you point it at, so it can
 * be run against production and answer the question rather than reasoning about it.
 *
 * It never prints a password and never prints a hash. It prints which account
 * matched which label, because that is what you have to act on.
 *
 * Usage:
 *   node --experimental-strip-types api/scripts/audit-passwords.mjs
 *   DATABASE_URL=... node --experimental-strip-types api/scripts/audit-passwords.mjs
 *
 * Exit 0: nothing matched. Exit 1: at least one account is reachable with a
 * published password — rotate it, and do it before anything else today.
 */

import { all, close } from '../src/db.ts';
import { verifyPassword } from '../src/auth.ts';

/**
 * Every password string this repository has ever published, with the label to
 * report. Add to this list, never remove from it: a credential does not stop
 * being public because the line was deleted from a README — git keeps it.
 */
const PUBLISHED = [
  { value: 'Curso2026*', where: 'api/README.md seeded-users table (student, tutor AND admin)' },
  { value: 'Curso2026', where: 'variant of the README value without the asterisk' },
  { value: 'curso', where: 'the default Postgres password in the dev DSN' },
  { value: 'changeme', where: 'generic placeholder' },
  { value: 'password', where: 'generic placeholder' },
];

/**
 * `all()` widens to Record<string, unknown> without a row type, which makes
 * `u.id` unknown and unusable as a SQL parameter. This is a .mjs file, so the
 * shape is declared in JSDoc rather than as a generic.
 *
 * @type {{ id: number, email: string, role: string, created_at: unknown }[]}
 */
const rows = await all(
  'SELECT id, email, role, created_at FROM users WHERE deleted_at IS NULL ORDER BY id',
);

if (rows.length === 0) {
  console.log('no live accounts to audit.');
  await close();
  process.exit(0);
}

console.log(`auditing ${rows.length} live account(s) against ${PUBLISHED.length} published password(s).`);
console.log('scrypt is deliberately slow, so this takes a few seconds per account.\n');

const hits = [];
for (const u of rows) {
  // The hash has to be fetched per user rather than in the query above, so a
  // dump of this script's own logs can never contain one.
  /** @type {{ pass_hash: string }[]} */
  const [{ pass_hash: stored }] = await all('SELECT pass_hash FROM users WHERE id = ?', [u.id]);
  for (const p of PUBLISHED) {
    // verifyPassword is the same function the login path uses, so a match here
    // means the login path would accept it too. Reimplementing the comparison
    // would risk testing something subtly different from what actually gates entry.
    if (await verifyPassword(p.value, stored)) {
      hits.push({ ...u, where: p.where });
      break;
    }
  }
  process.stdout.write('.');
}
process.stdout.write('\n\n');

await close();

if (hits.length === 0) {
  console.log(`ok: none of the ${rows.length} live accounts is opened by a published password.`);
  process.exit(0);
}

console.error(`${hits.length} account(s) accept a password published in this repository:\n`);
for (const h of hits) {
  const admin = h.role === 'admin' ? '  <-- ADMIN' : '';
  console.error(`  id ${h.id}  ${h.email}  role=${h.role}${admin}`);
  console.error(`      published in: ${h.where}`);
}
console.error(`
Rotate these now. For an account you own, change the password through the app —
that also bumps token_version, which kills every session already issued under the
old one. For an account nobody needs, delete the row; soft-delete keeps attempt
history consistent while removing the login.

An admin in that list is the urgent case: an admin session can change roles, so a
single reader of this repository can promote themselves.`);
process.exit(1);
