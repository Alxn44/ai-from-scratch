import type { APIRoute } from 'astro';

export const prerender = false;

const API = import.meta.env.API_URL ?? process.env.API_URL ?? 'http://127.0.0.1:8787';
const HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding']);

const proxy: APIRoute = async ({ request, params }) => {
  const path = params.path ?? '';
  const url = new URL(request.url);
  const target = `${API}/api/${path}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((v, k) => { if (!HOP.has(k)) headers.set(k, v); });

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
    redirect: 'manual',
  });

  const out = new Headers();
  res.headers.forEach((v, k) => { if (k !== 'content-encoding' && k !== 'content-length') out.append(k, v); });
  // Node 18+ expone varias Set-Cookie con getSetCookie()
  const cookies = (res.headers as any).getSetCookie?.() ?? [];
  if (cookies.length) { out.delete('set-cookie'); for (const c of cookies) out.append('set-cookie', c); }

  return new Response(res.body, { status: res.status, headers: out });
};

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
