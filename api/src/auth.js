import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.JWT_SECRET ?? 'dev-only-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET es obligatorio en producción');
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

export function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(plain, stored) {
  const [alg, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = scryptSync(plain, Buffer.from(saltB64, 'base64'), key.length);
  return key.length === test.length && timingSafeEqual(key, test);
}

export function sign(payload, ttlSeconds = 60 * 60 * 12) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64(JSON.stringify(body))}`;
  const sig = b64(createHmac('sha256', SECRET).update(data).digest());
  return `${data}.${sig}`;
}

export function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', SECRET).update(data).digest();
  const got = unb64(parts[2]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let body;
  try { body = JSON.parse(unb64(parts[1]).toString('utf8')); } catch { return null; }
  if (typeof body.exp !== 'number' || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

export const COOKIE = 'sid';
export const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 12,
};

// Recuperación de contraseña: el enlace lleva el token en claro, la base guarda
// solo su hash. Comparar hashes evita que un volcado de la base sirva para entrar.
export const nuevoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');
export const MINUTOS_TOKEN = 30;
