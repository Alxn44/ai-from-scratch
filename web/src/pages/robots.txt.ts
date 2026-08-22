import type { APIRoute } from 'astro';
import { SITE, PRIVADAS } from '../lib/site';

export const prerender = false;

// Los crawlers de LLM se nombran uno por uno a propósito: el permiso explícito
// evita que un bot conservador se abstenga por no encontrar regla propia.
const BOTS_IA = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
  'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended',
  'CCBot', 'Bytespider', 'meta-externalagent', 'cohere-ai', 'DeepSeekBot', 'MistralAI-User'];

export const GET: APIRoute = () => {
  const privadas = PRIVADAS.map((p) => `Disallow: ${p}`).join('\n');
  const bloques = [
    `User-agent: *\nAllow: /\n${privadas}`,
    ...BOTS_IA.map((b) => `User-agent: ${b}\nAllow: /\n${privadas}`),
    `Sitemap: ${SITE}/sitemap.xml`,
  ];
  return new Response(bloques.join('\n\n') + '\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
