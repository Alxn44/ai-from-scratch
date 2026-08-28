// Lapse sweep for monthly subscriptions. The cron calls it; it also works by hand.
//
//   node --experimental-strip-types api/scripts/expire-subscriptions.mjs
//   pnpm --dir api subs:expire
//
// The flag is needed for the same reason as close-leagues.mjs: this script
// imports src/data.ts directly and Node 22.13 does not strip types by default.
//
// WHY IT HAS TO EXIST. `auth.entitlement_apply` recomputes users.paid, but it
// only runs when a webhook arrives. users.paid is therefore a CACHE of the
// entitlement events, and a cache nobody refreshes goes stale in the expensive
// direction: a subscription whose period_end passed keeps paid = 1 until the
// provider says something. If the provider never says anything -- it failed, we
// changed provider, the account was closed on their side -- the access is free
// and permanent. This is the sweep that closes it without depending on anyone.
//
// It is IDEMPOTENT: the statement only touches rows that are paid = 1 AND have
// no live entitlement, so a second run in the same minute updates zero rows.
// The cron can be dumb and needs no lock.
//
// It only ever REVOKES. Granting access remains exclusive to a signed
// entitlement event; there is no branch here that sets paid = 1.
//
// When: hourly. The window between the period ending and access closing is at
// most one hour, which is the staleness we accept for not putting a join on the
// session read path.
//
//   crontab -e
//   7 * * * *  cd /path/to/repo && /usr/local/bin/node --experimental-strip-types app_ai_from_scratch/api/scripts/expire-subscriptions.mjs >> /tmp/subs.log 2>&1
import { write } from '../src/data.ts';

const closed = await write('auth.entitlement_sweep', {});
console.log(closed === 0
  ? 'sin vencimientos: ninguna cuenta perdio el acceso'
  : `cerradas ${closed} cuenta(s): su ultimo permiso ya vencio`);
