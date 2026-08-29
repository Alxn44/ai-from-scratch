#!/usr/bin/env node
/**
 * Coupon administration. Create, list, revoke.
 *
 * WHY THIS EXISTS RATHER THAN AN HTTP ENDPOINT
 * Coupons used to be created exactly one way: a hardcoded INSERT inside the schema
 * migration in src/db.ts, which planted ALXN-100 at 100% with max_redemptions NULL
 * on every deploy of every environment, with the code visible in the repository.
 * A 100% coupon bypasses Mercado Pago entirely (src/server.ts grants the
 * entitlement directly when totalMinor is 0) and registration is public, so that
 * row was an unlimited free-course faucet keyed by nothing but an email address.
 *
 * The replacement is a shell script, not an admin route, because that is the
 * stronger credential: creating money-shaped objects should require access to the
 * host, not a session cookie on a page one XSS away from an attacker. An admin UI
 * is a reasonable follow-up; it is not the safer starting point.
 *
 * WHY --max AND --hasta ARE REQUIRED AND HAVE NO DEFAULTS
 * The whole failure above was an omitted limit reading as "unlimited". A default
 * would reintroduce it. `crear` refuses to run without both, and refuses a 100%
 * coupon with a limit above MAX_LIBRE, because a 100% code that leaks is free
 * lifetime access to the paid corpus and the blast radius scales with the cap.
 *
 * Usage:
 *   pnpm coupon listar
 *   pnpm coupon crear ALXN100 --percent 100 --max 25 --dias 90
 *   pnpm coupon revocar ALXN100
 *   pnpm coupon activar ALXN100
 *
 * DATABASE_URL comes from payments/.env. Nothing here touches Mercado Pago.
 */

import pg from 'pg';

/** A 100% coupon above this cap is refused: it is free access, not a discount. */
const MAX_LIBRE = 100;

const argv = process.argv.slice(2);
const cmd = argv[0] ?? '';

const die = (msg) => { console.error(`coupon: ${msg}`); process.exit(1); };

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] ?? null;
}

const dsn = process.env.DATABASE_URL;
if (!dsn) die('DATABASE_URL is not set. Run from payments/ with --env-file-if-exists=.env.');

const normalize = (v) => String(v).trim().toUpperCase().replace(/\s+/g, '');

const pool = new pg.Pool({ connectionString: dsn, max: 2 });

/** Row -> one readable line. `usados` is reserved+redeemed, the same count reserveCoupon uses. */
function render(rows) {
  if (!rows.length) { console.log('(no coupons)'); return; }
  const w = Math.max(6, ...rows.map((r) => r.code.length));
  console.log(`${'code'.padEnd(w)}  pct  used/max   state     window`);
  for (const r of rows) {
    const tope = r.max_redemptions === null ? '∞' : r.max_redemptions;
    const estado = !r.active ? 'revoked'
      : r.ends_at && new Date(r.ends_at) <= new Date() ? 'expired'
      : r.starts_at && new Date(r.starts_at) > new Date() ? 'pending' : 'active';
    const win = r.ends_at ? `until ${new Date(r.ends_at).toISOString().slice(0, 10)}` : 'no end date';
    // Un cupon del 100 % sin tope es la forma exacta del fallo que motivo este
    // script, asi que se senala en la propia tabla y no en la documentacion.
    const aviso = r.percent === 100 && r.max_redemptions === null ? '   <-- FREE, UNCAPPED' : '';
    console.log(`${r.code.padEnd(w)}  ${String(r.percent).padStart(3)}  ${String(r.used).padStart(4)}/${String(tope).padEnd(4)}  ${estado.padEnd(8)}  ${win}${aviso}`);
  }
}

const SELECT = `
  SELECT c.code, c.percent, c.max_redemptions, c.active, c.starts_at, c.ends_at,
         (SELECT COUNT(*)::int FROM coupon_redemptions r
            WHERE r.coupon_id = c.id AND r.state IN ('reserved','redeemed')) AS used
    FROM coupons c ORDER BY c.created_at DESC, c.code`;

try {
  if (cmd === 'listar' || cmd === 'list' || cmd === '') {
    render((await pool.query(SELECT)).rows);

  } else if (cmd === 'crear' || cmd === 'create') {
    const code = normalize(argv[1] ?? '');
    if (!code) die('usage: crear <CODE> --percent N --max N --dias N');
    if (code.length > 64) die('code longer than 64 characters (reserveCoupon rejects it).');
    const percent = Number(flag('percent'));
    const max = Number(flag('max'));
    const dias = Number(flag('dias'));
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      die('--percent must be an integer 1..100 (the CHECK constraint enforces it too).');
    }
    if (!Number.isInteger(max) || max < 1) {
      die('--max is required and must be >= 1. There is no default, because an omitted '
        + 'limit is how an unlimited 100% coupon shipped in the first place.');
    }
    if (!Number.isInteger(dias) || dias < 1) die('--dias is required and must be >= 1.');
    if (percent === 100 && max > MAX_LIBRE) {
      die(`--percent 100 with --max ${max} is refused. A 100% coupon skips Mercado Pago and `
        + `grants the course outright, so the cap is the entire exposure; ${MAX_LIBRE} is the `
        + `ceiling this script allows. Raise MAX_LIBRE deliberately if you mean it.`);
    }
    const res = await pool.query(
      `INSERT INTO coupons (code, percent, max_redemptions, active, starts_at, ends_at)
         VALUES ($1,$2,$3,true, now(), now() + ($4 || ' days')::interval)
       ON CONFLICT (code) DO NOTHING
       RETURNING code`, [code, percent, max, String(dias)]);
    if (!res.rowCount) die(`${code} already exists. Revoke it first, or pick another code.`);
    console.log(`created ${code}: ${percent}% off, up to ${max} redemptions, expires in ${dias} days.`);
    render((await pool.query(SELECT)).rows);

  } else if (cmd === 'revocar' || cmd === 'revoke' || cmd === 'activar' || cmd === 'activate') {
    const activo = cmd === 'activar' || cmd === 'activate';
    const code = normalize(argv[1] ?? '');
    if (!code) die(`usage: ${cmd} <CODE>`);
    const res = await pool.query(`UPDATE coupons SET active=$2 WHERE code=$1 RETURNING code`, [code, activo]);
    if (!res.rowCount) die(`${code} not found.`);
    console.log(`${code}: active=${activo}`);
    // Revocar no borra: las redenciones ya concedidas siguen siendo validas, y eso
    // es correcto. Quien ya tiene acceso lo conserva; el codigo deja de abrir mas.
    render((await pool.query(SELECT)).rows);

  } else {
    die(`unknown command '${cmd}'. One of: listar, crear, revocar, activar.`);
  }
} finally {
  await pool.end();
}
