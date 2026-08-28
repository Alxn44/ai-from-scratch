// The price, on the web side, in one place.
//
// WHY THIS IS SEPARATE FROM site.ts. site.ts reads `import.meta.env`, which only
// exists inside the Astro build; plain Node throws on it. The price has to be
// readable from a Node script so `pnpm verify` can compare it against what the
// payments service actually charges, so it lives in a module with no build-time
// globals. site.ts re-exports it, and every existing call site keeps working.
//
// WHY A COPY EXISTS AT ALL. `payments/src/price.ts` is the source of truth: it is
// the number that reaches Mercado Pago. web/ is a separate package with its own
// install, so it cannot import across the boundary at build time. The copy is
// therefore unavoidable — what is avoidable is the DRIFT, and that is what
// `scripts/check-price.mjs` fails on. A landing page advertising one number while
// the checkout charges another is the failure this guards.

/** ISO-4217. Must equal CURRENCY in payments/src/price.ts. */
export const MONEDA = 'COP';

/** Decimals of MONEDA. COP: 0. Must equal DECIMALS in payments/src/price.ts. */
export const DECIMALES = 0;

/** Monthly price in MINOR units. Must equal PRICE_MINOR in payments/src/price.ts. */
export const PRECIO_MENOR = 35_000;

/**
 * The bare number, no separators: `35000`.
 *
 * This is the schema.org form. `price` in a JSON-LD Offer must be a plain number
 * — a thousands separator there is a parse error for the crawler, not a style
 * choice, and `35.000` would be read as thirty-five.
 */
export const PRECIO = String(DECIMALES === 0
  ? PRECIO_MENOR
  : (PRECIO_MENOR / 10 ** DECIMALES).toFixed(DECIMALES));

/**
 * The price as PROSE, per language: `35.000` in Spanish, `35,000` in English.
 *
 * Colombia writes thirty-five thousand as 35.000 and the anglophone world writes
 * it 35,000. Getting this backwards does not look like a typo, it looks like a
 * different price by three orders of magnitude, so the separator is part of the
 * translation and not a formatting detail.
 */
export const PRECIO_TEXTO: Record<string, string> = {
  es: (PRECIO_MENOR / 10 ** DECIMALES).toLocaleString('es-CO'),
  en: (PRECIO_MENOR / 10 ** DECIMALES).toLocaleString('en-US'),
};

/**
 * El precio TACHADO que la landing muestra al lado del real.
 *
 * NO es un precio que se haya cobrado nunca: es un ancla de marketing, y estaba
 * escrito a mano como `$49` en cuatro sitios cuando el precio eran USD 9.99 —
 * un ratio de 4,9×. Aquí se conserva ese mismo ratio sobre 35.000, redondeado a
 * un número que se lee: 175.000.
 *
 * Vive declarado y con nombre precisamente porque es una afirmación sobre el
 * pasado que nadie puede verificar. Si el dueño del producto no quiere sostener
 * ese «antes», se borra de aquí y desaparece de las cuatro pantallas a la vez.
 */
export const PRECIO_ANCLA_MENOR = 175_000;

/** El ancla como prosa, por idioma. Misma regla de separador que PRECIO_TEXTO. */
export const ANCLA_TEXTO: Record<string, string> = {
  es: (PRECIO_ANCLA_MENOR / 10 ** DECIMALES).toLocaleString('es-CO'),
  en: (PRECIO_ANCLA_MENOR / 10 ** DECIMALES).toLocaleString('en-US'),
};

/**
 * Una cantidad en unidades menores como prosa: `35.000 COP`.
 *
 * Existe para el cupón, que es el único importe que la web no conoce de antemano.
 * Antes el navegador hacía `(result.totalCents / 100).toFixed(2)` y le pegaba
 * «USD» delante: con COP eso pintaba «USD 350.00» sobre un cobro de 35.000 pesos.
 */
export function textoImporte(menor: number, lang = 'es'): string {
  const valor = menor / 10 ** DECIMALES;
  const loc = lang === 'en' ? 'en-US' : 'es-CO';
  return `${valor.toLocaleString(loc, { minimumFractionDigits: DECIMALES,
    maximumFractionDigits: DECIMALES })} ${MONEDA}`;
}

/**
 * El precio tal y como se PINTA en grande, con su marcador de moneda.
 *
 * Por qué el marcador cambia de idioma y no solo el separador: en Colombia `$`
 * significa pesos y `$35.000` se lee sin ambigüedad. En inglés `$35,000` se lee
 * treinta y cinco mil DÓLARES, que es mil veces el precio — un error de otra
 * clase que el del separador de miles. Así que en inglés el símbolo se cae y la
 * moneda se escribe: `35,000 COP`.
 */
export const PRECIO_VISUAL: Record<string, string> = {
  es: `$${PRECIO_TEXTO.es}`,
  en: `${PRECIO_TEXTO.en} ${MONEDA}`,
};

/** El ancla tachada, misma regla de marcador que PRECIO_VISUAL. */
export const ANCLA_VISUAL: Record<string, string> = {
  es: `$${ANCLA_TEXTO.es}`,
  en: `${ANCLA_TEXTO.en} ${MONEDA}`,
};
