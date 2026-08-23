// Set de iconos de la plataforma. Rejilla 24, trazo 1.6, caps y joins redondos.
// Fuente única: lo usan las páginas de Astro y los artboards del diseño.
export const PATHS: Record<string, string> = {
  home:      'M4 10.6 12 4l8 6.6V19a1 1 0 0 1-1 1h-4.6v-5.8H9.6V20H5a1 1 0 0 1-1-1z',
  book:      'M12 6.6C10.4 5.2 8.5 4.5 6 4.5H4.2v12.8H6c2.5 0 4.4.7 6 2.1 1.6-1.4 3.5-2.1 6-2.1h1.8V4.5H18c-2.5 0-4.4.7-6 2.1zM12 6.6v12.8',
  lab:       'M9.2 3.2h5.6M10.6 3.2v5.5l-4.3 8.2A1.9 1.9 0 0 0 8 19.8h8a1.9 1.9 0 0 0 1.7-2.9l-4.3-8.2V3.2M7.9 14.2h8.2',
  chart:     'M4 20h16M8 16.4V11M12 16.4V5.6M16 16.4v-3.8',
  user:      'M12 12.4a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8zM4.8 19.8c.6-3.2 3.6-5 7.2-5s6.6 1.8 7.2 5',
  users:     'M9.4 11.6a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM3.2 19.8c.5-2.9 3.1-4.6 6.2-4.6s5.7 1.7 6.2 4.6M16.2 5.6a3 3 0 0 1 0 5.7M17.6 15.5c2 .5 3.2 1.9 3.4 4.3',
  gear:      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2.9v2.3M12 18.8v2.3M2.9 12h2.3M18.8 12h2.3M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6',
  card:      'M3.2 7.4A2.2 2.2 0 0 1 5.4 5.2h13.2a2.2 2.2 0 0 1 2.2 2.2v9.2a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1-2.2-2.2zM3.2 10.2h17.6M6.4 14.6h3.2',
  shield:    'M12 3.2 19 5.6v5.2c0 4.1-2.8 7.6-7 9-4.2-1.4-7-4.9-7-9V5.6zM9.2 11.8l2 2 3.6-3.8',
  download:  'M12 4v9.6M8.2 10.2 12 14l3.8-3.8M4.6 19.4h14.8',
  check:     'M5 12.6l4.4 4.4L19 7.2',
  x:         'M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8',
  alert:     'M12 4.4 2.8 19.6h18.4zM12 9.6v4.2M12 16.4v.1',
  info:      'M12 20.2a8.2 8.2 0 1 0 0-16.4 8.2 8.2 0 0 0 0 16.4zM12 11v5.4M12 8.1v.1',
  clock:     'M12 20.2a8.2 8.2 0 1 0 0-16.4 8.2 8.2 0 0 0 0 16.4zM12 7.4V12l3.4 2',
  logout:    'M14.2 6.6V5.4A2.2 2.2 0 0 0 12 3.2H5.6a2.2 2.2 0 0 0-2.2 2.2v13.2a2.2 2.2 0 0 0 2.2 2.2H12a2.2 2.2 0 0 0 2.2-2.2v-1.2M9.6 12h11M16.8 8.6 20.6 12l-3.8 3.4',
  play:      'M7.4 4.8 18.6 12 7.4 19.2z',
  spark:     'M12 3.2l1.7 5.6 5.6 1.7-5.6 1.7L12 17.8l-1.7-5.6L4.7 10.5l5.6-1.7z',
  pdf:       'M5.6 3.2h7L18.4 9v11.8H5.6zM12.4 3.3V9h5.9M8.4 17.4v-4h1.1a1.2 1.2 0 0 1 0 2.4H8.4M13 17.4v-4h1.1a1.6 1.6 0 0 1 1.6 1.6v.8a1.6 1.6 0 0 1-1.6 1.6z',
  lock:      'M5.6 11.2A1.4 1.4 0 0 1 7 9.8h10a1.4 1.4 0 0 1 1.4 1.4v7.2A1.4 1.4 0 0 1 17 19.8H7a1.4 1.4 0 0 1-1.4-1.4zM8.4 9.8V7.6a3.6 3.6 0 0 1 7.2 0v2.2M12 13.6v2.4',
  arrow:     'M4.8 12h13.4M13.6 6.6 19 12l-5.4 5.4',
  refresh:   'M20 12a8 8 0 1 1-2.6-5.9M20 4.4V9h-4.6',
  eye:       'M2.8 12S6.4 6.2 12 6.2 21.2 12 21.2 12S17.6 17.8 12 17.8 2.8 12 2.8 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

const FILLED = new Set(['play', 'spark']);

export function icon(name: keyof typeof PATHS | string, size = 20, color = 'currentColor', sw = 1.6): string {
  const d = PATHS[name as string];
  if (!d) throw new Error(`icono desconocido: ${String(name)}`);
  const fill = FILLED.has(name as string) ? color : 'none';
  const stroke = FILLED.has(name as string) ? 'none' : color;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="flex:none" aria-hidden="true"><path d="${d}"/></svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
