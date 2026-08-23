import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Static output (SSG) — highest delivery performance for these pages.
// - compressHTML: minify emitted HTML
// - inlineStylesheets 'always': fold CSS into the doc → fewer requests
// - GSAP/html2canvas are bundled+minified by Vite (no render-blocking CDN)
export default defineConfig({
  // Landing y curso siguen estáticos (prerender por defecto).
  // Las páginas de la plataforma marcan `prerender = false` y corren en el servidor:
  // necesitan leer la cookie de sesión antes de renderizar.
  adapter: node({ mode: 'standalone' }),
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
  },
  vite: {
    build: {
      cssMinify: true,
      target: 'es2020',
    },
  },
});
