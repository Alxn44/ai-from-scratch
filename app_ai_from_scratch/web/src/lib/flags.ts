// Banderas dibujadas en SVG. NUNCA emoji: Windows no incluye los glifos de
// indicador regional, así que Chrome y Edge pintan las dos letras del código en
// un recuadro — para media base de compradores la bandera no existiría.
//
// Regla dura: la bandera es de la REGIÓN de quien mira, no del idioma. Un idioma
// no tiene país (español no es España para un colombiano). Y si el idioma elegido
// no se habla en esa región, no se muestra bandera: se muestra el idioma.

const PATHS: Record<string, string> = {
  CO: '<rect width="24" height="8" fill="#FCD116"/><rect y="8" width="24" height="4" fill="#003893"/><rect y="12" width="24" height="4" fill="#CE1126"/>',
  MX: '<rect width="8" height="16" fill="#006847"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#CE1126"/><circle cx="12" cy="8" r="2.1" fill="none" stroke="#9B7D3A" stroke-width=".8"/>',
  AR: '<rect width="24" height="16" fill="#fff"/><rect width="24" height="5.33" fill="#74ACDF"/><rect y="10.67" width="24" height="5.33" fill="#74ACDF"/><circle cx="12" cy="8" r="1.7" fill="#F6B40E"/>',
  ES: '<rect width="24" height="16" fill="#AA151B"/><rect y="4" width="24" height="8" fill="#F1BF00"/>',
  US: '<rect width="24" height="16" fill="#fff"/><rect y="0" width="24" height="1.24" fill="#B22234"/><rect y="2.46" width="24" height="1.24" fill="#B22234"/><rect y="4.92" width="24" height="1.24" fill="#B22234"/><rect y="7.39" width="24" height="1.24" fill="#B22234"/><rect y="9.85" width="24" height="1.24" fill="#B22234"/><rect y="12.31" width="24" height="1.24" fill="#B22234"/><rect y="14.77" width="24" height="1.23" fill="#B22234"/><rect width="10.2" height="8.62" fill="#3C3B6E"/>',
  GB: '<rect width="24" height="16" fill="#012169"/><path d="M0 0 24 16M24 0 0 16" stroke="#fff" stroke-width="3.2"/><path d="M0 0 24 16M24 0 0 16" stroke="#C8102E" stroke-width="1.7"/><path d="M12 0V16M0 8H24" stroke="#fff" stroke-width="5.3"/><path d="M12 0V16M0 8H24" stroke="#C8102E" stroke-width="3.2"/>',
  FR: '<rect width="8" height="16" fill="#002395"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#ED2939"/>',
  BR: '<rect width="24" height="16" fill="#009B3A"/><path d="M12 1.6 22.4 8 12 14.4 1.6 8Z" fill="#FEDF00"/><circle cx="12" cy="8" r="3.1" fill="#002776"/><path d="M9.1 7.1c2 -.9 4.2 -.6 5.9 .5" stroke="#fff" stroke-width=".7" fill="none"/>',
  PT: '<rect width="24" height="16" fill="#FF0000"/><rect width="9.6" height="16" fill="#006600"/><circle cx="9.6" cy="8" r="3" fill="none" stroke="#FFE900" stroke-width="1"/><circle cx="9.6" cy="8" r="1.4" fill="#fff"/>',
};

// Zona horaria del navegador → país. Es lo único que el navegador entrega de
// verdad: el sistema operativo no reporta el país, y navigator.language llega a
// menudo como 'es' pelado, sin la parte regional.
const ZONAS: Record<string, string> = {
  'America/Bogota': 'CO',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR',
  'Europe/Madrid': 'ES',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Phoenix': 'US',
  'Europe/London': 'GB',
  'Europe/Paris': 'FR',
  'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR',
  'Europe/Lisbon': 'PT',
};

// Idiomas que se hablan en cada región.
const REGION_LANGS: Record<string, string[]> = {
  CO: ['es'], MX: ['es'], AR: ['es'], ES: ['es'],
  US: ['en'], GB: ['en'], FR: ['fr'], BR: ['pt'], PT: ['pt'],
};

export const LANG_NAMES: Record<string, string> = {
  es: 'Español', en: 'English', fr: 'Français', pt: 'Português',
};

/** País de quien mira, o null si su zona horaria no está mapeada. */
export function regionActual(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return ZONAS[tz] ?? null;
  } catch {
    return null;
  }
}

export function flagSvg(cc: string, w = 22): string {
  const d = PATHS[cc];
  if (!d) return '';
  const h = Math.round((w * 2) / 3);
  return `<svg viewBox="0 0 24 16" width="${w}" height="${h}" style="flex:none;display:block" aria-hidden="true">${d}</svg>`;
}

/**
 * Bandera para el idioma que se acaba de elegir. Devuelve null cuando mostrarla
 * sería mentira: región desconocida, o idioma que no se habla en esa región
 * (Colombia + francés no lleva ni la de Colombia ni la de Francia).
 */
export function flagFor(lang: string, w = 22): { cc: string; svg: string } | null {
  const cc = regionActual();
  if (!cc) return null;
  if (!(REGION_LANGS[cc] ?? []).includes(lang)) return null;
  const svg = flagSvg(cc, w);
  return svg ? { cc, svg } : null;
}
