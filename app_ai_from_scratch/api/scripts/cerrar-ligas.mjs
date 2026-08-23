// Cierre semanal de ligas. Lo llama el cron; tambien vale a mano.
//
//   node api/scripts/cerrar-ligas.mjs
//   pnpm ligas:cerrar
//
// Es IDEMPOTENTE (PK user_id+week con DO NOTHING): si el cron falla y reintenta,
// o si lo corres dos veces, no duplica ni altera nada. Por eso el cron puede ser
// tonto y no necesita bloqueo distribuido.
//
// Cuando: lunes 00:05 en America/Bogota, cinco minutos despues del corte, para
// que ningun intento de las 23:59:59 se quede fuera por reloj.
//
//   crontab -e
//   5 0 * * 1  cd /ruta/al/repo && /usr/local/bin/node api/scripts/cerrar-ligas.mjs >> /tmp/ligas.log 2>&1
//
// Si la maquina no vive en Bogota, el crontab hay que ponerlo en la hora local
// equivalente, o meterle CRON_TZ=America/Bogota arriba del archivo.
import { pool, ready } from '../src/db.js';
import { cerrarSemana } from '../src/ligas.js';

await ready();
const r = await cerrarSemana();
if (r.motivo === 'cohorte_insuficiente') {
  console.log(`sin cerrar: ${r.total} personas apuntadas, hacen falta ${r.minimo}`);
} else {
  // La columna DATE llega como Date de JS y se imprime con zona y todo: en un log
  // de cron eso confunde sobre que semana se cerro. Se recorta a la fecha.
  const dia = r.semana instanceof Date ? r.semana.toISOString().slice(0, 10) : String(r.semana).slice(0, 10);
  console.log(`semana ${dia}: ${r.cerradas} filas nuevas, ${r.saltadas} ya estaban (de ${r.total})`);
}
await pool.end();
