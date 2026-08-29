// El precio y la moneda, en UN solo sitio.
//
// POR QUÉ ESTE FICHERO EXISTE. El precio estaba en `PRICE_CENTS = 999` dentro de
// db.ts y en dos literales `9.99` dentro de mercadopago.ts, y la conversión al
// importe que recibe el proveedor era un `/ 100` escrito a mano en dos sitios más
// (mercadopago.ts y web/src/pages/pago.astro). Pasar a COP con esa forma es una
// trampa de un solo carácter: poner 35000 donde había 999 y dejar los `/100`
// intactos cobra 350 pesos en vez de 35.000, y el cobro sale sin error.
//
// LA UNIDAD MENOR NO SIEMPRE ES UN CÉNTIMO. USD tiene dos decimales, así que
// «cents» y «unidad menor» coincidían y nadie tuvo que distinguirlos. COP no
// tiene decimales en la práctica: Mercado Pago espera 35000, no 3500000. Por eso
// el exponente es un dato explícito y no un 100 repartido por el código, y por
// eso los campos ya no se llaman *Cents — un nombre que dice «céntimos» mientras
// guarda pesos es peor que no tener nombre.
export const CURRENCY = 'COP';

/**
 * Decimales de la moneda. COP: 0. USD sería 2.
 *
 * Es lo único que hay que tocar, junto con PRICE_MINOR y CURRENCY, para volver a
 * una moneda con céntimos.
 */
export const DECIMALS = 0;

/**
 * El precio mensual en unidades MENORES de CURRENCY.
 *
 * COP 35.000 al mes. Con DECIMALS = 0, la unidad menor es el peso, así que este
 * número es el precio tal cual.
 */
export const PRICE_MINOR = 35_000;

/**
 * De unidad menor al importe que espera el proveedor.
 *
 * Con DECIMALS = 0 es la identidad, y ESO ES LO IMPORTANTE: la división ya no
 * está escrita a mano en cada llamada, así que cambiar de moneda no deja un
 * `/100` huérfano cobrando la centésima parte.
 */
export function providerAmount(minor: number): number {
  return DECIMALS === 0 ? minor : Number((minor / 10 ** DECIMALS).toFixed(DECIMALS));
}

/** Para logs y mensajes: «35.000 COP». Separador de miles del locale colombiano. */
export function formatMinor(minor: number): string {
  return `${providerAmount(minor).toLocaleString('es-CO')} ${CURRENCY}`;
}
