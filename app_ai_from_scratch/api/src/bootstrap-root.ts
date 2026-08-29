// One-time production root provisioning.
//
// This belongs to the one-shot `init` service, immediately after `prisma migrate
// deploy`, rather than to a SQL migration.  A migration is checked into Git and
// therefore cannot safely contain a reusable password (nor its offline-crackable
// hash).  The password reaches this process only through the deployment secret,
// is turned into the same scrypt representation used by normal registration,
// and is never printed.
import { get, pool, run } from './db.ts';
import { hashPassword } from './auth.ts';

const login = String(process.env.BOOTSTRAP_ROOT_USER ?? '').trim().toLowerCase();
const password = process.env.BOOTSTRAP_ROOT_PASSWORD ?? '';
const configured = Boolean(login || password);

if (!configured) {
  console.info('root bootstrap: not configured');
  await pool.end();
  process.exit(0);
}

if (process.env.NODE_ENV !== 'production') {
  throw new Error('BOOTSTRAP_ROOT_* is only accepted by the production init service.');
}
if (!login || !password) {
  throw new Error('BOOTSTRAP_ROOT_USER and BOOTSTRAP_ROOT_PASSWORD must be set together.');
}
// The application calls this column `email`, but login deliberately accepts the
// opaque root handle too (the existing local root account works the same way).
// Keep it narrow so this privileged identity cannot be created with whitespace,
// an accidental shell fragment, or a display-only name.
if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login)) {
  throw new Error('BOOTSTRAP_ROOT_USER must be a 3-64 character lowercase login handle.');
}
if (password.length < 8) {
  throw new Error('BOOTSTRAP_ROOT_PASSWORD must have at least 8 characters.');
}

const existing = await get<{ id: number; role: string }>(
  'SELECT id, role FROM users WHERE email = ?', [login]);

if (existing) {
  // Never reset a password on a later deployment.  The secret can be removed
  // after this first successful release without locking the account out.
  if (existing.role !== 'root') {
    await run('UPDATE users SET role = ?, paid = ?, deleted_at = NULL WHERE id = ?',
      ['root', 1, existing.id]);
    console.info({ id: existing.id, login }, 'root bootstrap: existing account promoted');
  } else {
    console.info({ id: existing.id, login }, 'root bootstrap: existing root unchanged');
  }
} else {
  const hash = await hashPassword(password);
  const created = await run(
    'INSERT INTO users (email, name, pass_hash, role, paid) VALUES (?, ?, ?, ?, ?)',
    [login, login, hash, 'root', 1]);
  console.info({ login, created: created.rowCount === 1 }, 'root bootstrap: account created');
}

await pool.end();
