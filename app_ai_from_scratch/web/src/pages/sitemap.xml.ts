import type { APIRoute } from 'astro';
import { SITE, PUBLICAS } from '../lib/site';

export const prerender = false;

const PESO: Record<string, string> = { '/': '1.0', '/pago': '0.9', '/registro': '0.7', '/login': '0.5' };

export const GET: APIRoute = () => {
  // Las páginas públicas se sirven en es y en según el visitante: se declara
  // hreflang para que el buscador entienda que es la misma URL en dos idiomas.
  const hoy = new Date().toISOString().slice(0, 10);
  const urls = PUBLICAS.map((p) => `  <url>
    <loc>${SITE}${p}</loc>
    <lastmod>${hoy}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${PESO[p] ?? '0.6'}</priority>
    <xhtml:link rel="alternate" hreflang="es" href="${SITE}${p}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${p}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${p}"/>
  </url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
