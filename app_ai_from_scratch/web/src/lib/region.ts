// De dónde se conecta quien mira. Tres fuentes, en orden de fiabilidad:
//   1. cabecera geo del CDN (Cloudflare, Vercel, Fastly) — la única exacta
//   2. la región del Accept-Language (es-CO, en-US, pt-BR…)
//   3. el idioma solo, como último recurso
// El sistema operativo NO reporta país: por eso no se promete precisión y la
// narrativa nunca depende de acertar (si no se sabe, se usa la neutra).
export type Mercado = 'co' | 'latam' | 'us' | 'eu' | 'global';

const LATAM = ['MX', 'AR', 'CL', 'PE', 'EC', 'UY', 'PY', 'BO', 'VE', 'CR', 'PA', 'GT', 'DO', 'HN', 'SV', 'NI', 'BR'];
const EU = ['ES', 'FR', 'DE', 'IT', 'PT', 'NL', 'BE', 'IE', 'AT', 'PL', 'SE', 'DK', 'FI', 'CZ', 'RO', 'GR', 'HU',
  'BG', 'HR', 'SK', 'SI', 'LT', 'LV', 'EE', 'LU', 'MT', 'CY', 'GB', 'NO', 'CH', 'IS'];

const CABECERAS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code', 'fastly-client-country', 'x-appengine-country'];

export function paisDe(request: Request): string | null {
  for (const h of CABECERAS) {
    const v = request.headers.get(h);
    if (v && /^[A-Za-z]{2}$/.test(v) && v.toUpperCase() !== 'XX') return v.toUpperCase();
  }
  const al = request.headers.get('accept-language') ?? '';
  const m = al.match(/[a-z]{2,3}-([A-Z]{2})/);
  return m ? m[1] : null;
}

export function mercadoDe(request: Request): { mercado: Mercado; pais: string | null } {
  const pais = paisDe(request);
  if (!pais) return { mercado: 'global', pais: null };
  if (pais === 'CO') return { mercado: 'co', pais };
  if (pais === 'US' || pais === 'CA') return { mercado: 'us', pais };
  if (EU.includes(pais)) return { mercado: 'eu', pais };
  if (LATAM.includes(pais)) return { mercado: 'latam', pais };
  return { mercado: 'global', pais };
}
