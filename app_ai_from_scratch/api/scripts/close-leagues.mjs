// Weekly league close. The cron calls it; it also works by hand.
//
//   node --experimental-strip-types api/scripts/close-leagues.mjs
//   pnpm --dir api leagues:close
//
// The flag is needed because this script imports src/leagues.ts directly: Node
// 22.13 reports process.features.typescript === false, so type stripping is not
// on by default.
//
// It is IDEMPOTENT (PK user_id+week with DO NOTHING): if the cron fails and
// retries, or if you run it twice, it duplicates and alters nothing. That is why
// the cron can be dumb and needs no distributed lock.
//
// When: Monday 00:05 in America/Bogota, five minutes after the cut-off, so that no
// attempt made at 23:59:59 is left out because of the clock.
//
//   crontab -e
//   5 0 * * 1  cd /path/to/repo && /usr/local/bin/node --experimental-strip-types api/scripts/close-leagues.mjs >> /tmp/leagues.log 2>&1
//
// If the machine does not live in Bogota, the crontab has to use the equivalent
// local time, or carry CRON_TZ=America/Bogota at the top of the file.
import { pool, ready } from '../src/db.ts';
import { closeWeek } from '../src/leagues.ts';

await ready();
const r = await closeWeek();
if ('motivo' in r && r.motivo === 'cohorte_insuficiente') {
  console.log(`sin cerrar: ${r.total} personas apuntadas, hacen falta ${r.minimo}`);
} else {
  // The DATE column arrives as a JS Date and prints with zone and all: in a cron
  // log that confuses which week was closed. It is trimmed to the date.
  const raw = 'semana' in r ? r.semana : null;
  const day = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
  console.log(`semana ${day}: ${r.cerradas} filas nuevas, ${r.saltadas} ya estaban (de ${r.total})`);
}
await pool.end();
