// The proactive assistant's read (src/coach.ts). Postgres, no server, no network.
//
// WHAT THIS IS FOR. The floating AI panel decides what to say from these fields
// alone, so a wrong field is a nudge that lies to the student — "you have not
// solved anything in 3 days" to somebody who solved a lab this morning. The two
// values worth guarding are the ones no other suite covers: `diasSinActividad`,
// a subtraction of two dates in the product zone, and `siguiente`, which has to
// respect the paywall.
//
// It works on a SCRATCH ACCOUNT of its own, created and dropped here. Reading the
// seeded students would make every assertion depend on whatever the seed happens
// to hold, and writing to them would corrupt the isolation suite's fixtures.
import { strict as A } from 'node:assert';
import { all, get, migrate, run } from '../src/db.ts';
import { coachState } from '../src/coach.ts';
import type { CoachNextNone } from '../src/coach.ts';
import { TOTAL_LABS, TOTAL_LESSONS } from '../src/tools/access.ts';

let passed = 0, failed = 0;
const test = (name: string, fn: () => void): void => { try { fn(); console.log(`  ok   · ${name}`); passed++; }
  catch (e) { console.log(`  FAIL · ${name}\n         ${e instanceof Error ? e.message : String(e)}`); failed++; } };

const EMAIL = 'coach-suite@test.local';
const drop = (): Promise<unknown> => run('DELETE FROM users WHERE email = ?', [EMAIL]);

await migrate();
await drop();

console.log('\nthe proactive assistant read');

try {
  // Paid, so the paywall is not what is being measured yet.
  const created = await get<{ id: number }>(
    `INSERT INTO users (email, name, pass_hash, role, lang, theme, paid)
     VALUES (?, ?, 'not-a-real-hash', 'student', 'es', 'auto', 1) RETURNING id`,
    [EMAIL, 'Coach FromTheSuite Second']);
  const uid = created!.id;

  // The first lab the course offers, derived with a DIFFERENT query than the one
  // under test: nextStep() walks pending(), this reads `labs` straight.
  const first = await get<{ id: string }>(
    'SELECT id FROM labs WHERE draft = 0 ORDER BY lesson_n, idx LIMIT 1');

  // --- nothing solved yet -------------------------------------------------
  const fresh = (await coachState(uid, 'es'))!;
  test('a new account gets a state, not null', () => A.ok(fresh));
  test('the name is the first name only', () => A.equal(fresh.nombre, 'Coach'));
  test('with no attempts, solved labs is 0', () => A.equal(fresh.labsResueltos, 0));
  test('with no attempts there is no last day', () => A.equal(fresh.ultimoDia, null));
  test('«never» is not «long ago»: diasSinActividad is null, not a number', () =>
    A.equal(fresh.diasSinActividad, null));
  test('with no attempts the streak is 0', () => A.equal(fresh.racha, 0));
  test('the totals are the course totals', () => {
    A.equal(fresh.totalLabs, TOTAL_LABS);
    A.equal(fresh.totalLecciones, TOTAL_LESSONS);
    A.equal(fresh.porLeccion.length, TOTAL_LESSONS);
  });
  test('what is next is the first written lab of the course', () => {
    A.equal(fresh.siguiente.hay, true);
    A.equal(fresh.siguiente.hay && fresh.siguiente.lab_id, first!.id);
  });

  // --- one lab solved four days ago ---------------------------------------
  await run(`INSERT INTO attempts (user_id, lab_id, answer, correct, at)
             VALUES (?, ?, '"ok"', 1, now() - (?::int || ' days')::interval)`,
    [uid, first!.id, 4]);
  const stale = (await coachState(uid, 'es'))!;
  test('four days without solving counts as 4', () => A.equal(stale.diasSinActividad, 4));
  test('a streak that already broke is 0, not 1', () => A.equal(stale.racha, 0));
  test('but the active day still counts', () => A.equal(stale.diasActivos, 1));
  test('the solved lab is added up', () => A.equal(stale.labsResueltos, 1));
  test('solved labs equal the sum over the lessons', () =>
    A.equal(stale.labsResueltos, stale.porLeccion.reduce((s, r) => s + r.resueltos, 0)));
  test('what is next is no longer the lab that was solved', () =>
    A.ok(stale.siguiente.hay && stale.siguiente.lab_id !== first!.id));

  // --- yesterday and today ------------------------------------------------
  const rest = await all<{ id: string }>(
    'SELECT id FROM labs WHERE lesson_n = 1 AND id <> ? ORDER BY idx', [first!.id]);
  await run(`INSERT INTO attempts (user_id, lab_id, answer, correct, at)
             VALUES (?, ?, '"ok"', 1, now() - INTERVAL '1 day')`, [uid, rest[0]!.id]);
  await run(`INSERT INTO attempts (user_id, lab_id, answer, correct, at)
             VALUES (?, ?, '"ok"', 1, now())`, [uid, rest[1]!.id]);
  const today = (await coachState(uid, 'es'))!;
  test('solving today puts diasSinActividad at 0', () => A.equal(today.diasSinActividad, 0));
  test('today and yesterday in a row is a streak of 2', () => A.equal(today.racha, 2));
  test('the best streak does not go down', () => A.ok(today.mejorRacha >= 2));
  test('lesson 1 counts as closed', () => A.equal(today.leccionesCerradas, 1));

  // --- the paywall is part of «what next» ---------------------------------
  await run('UPDATE users SET paid = 0 WHERE id = ?', [uid]);
  const unpaid = (await coachState(uid, 'es'))!;
  test('unpaid with lesson 1 closed, what is next is NOT a lab', () =>
    A.equal(unpaid.siguiente.hay, false));
  // Cast rather than narrow: the assertion above is what proves the branch, and
  // `strict` is off in this project so the discriminant does not narrow inside a
  // closure. If the branch were the other one, the assertions below fail loudly.
  const blocked = unpaid.siguiente as CoachNextNone;
  test('and it says the purchase is what is missing, naming the lesson', () => {
    A.equal(blocked.motivo, 'requiere_compra');
    A.equal(blocked.siguienteCerrado, 2);
  });
  test('the state says the account has not paid', () => A.equal(unpaid.pagado, false));

  // --- it only ever describes the asking account --------------------------
  const other = await get<{ id: number; name: string; email: string }>(
    'SELECT id, name, email FROM users WHERE id <> ? AND deleted_at IS NULL ORDER BY id LIMIT 1', [uid]);
  if (other) {
    const blob = JSON.stringify(unpaid);
    test('the state does not contain another account\'s name', () => A.ok(!blob.includes(other.name)));
    test('the state does not contain another account\'s email', () => A.ok(!blob.includes(other.email)));
    const theirs = await coachState(other.id, 'es');
    test('asking for another account returns THAT account, not mine', () =>
      A.notEqual(theirs?.nombre, unpaid.nombre));
  }

  // --- fails closed -------------------------------------------------------
  const ghost = await coachState(0, 'es');
  test('an id that does not exist returns null, not an empty state', () => A.equal(ghost, null));
  await run('UPDATE users SET deleted_at = now() WHERE id = ?', [uid]);
  const deleted = await coachState(uid, 'es');
  test('a deleted account returns null', () => A.equal(deleted, null));
} finally {
  await drop();
}

console.log(failed ? `\n${failed} failure(s) of ${passed + failed}` : `\nno failures (${passed} checks)`);
process.exit(failed ? 1 : 0);
