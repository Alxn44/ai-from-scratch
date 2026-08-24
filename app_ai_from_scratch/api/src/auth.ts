import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';


// Session signing key.
//
// There is deliberately NO fallback constant. A known default is a forgeable
// admin session: whoever reads the repository can sign {sub, role:'admin'} and
// walk in without an account. The previous guard only fired when NODE_ENV was
// exactly 'production', and no deployment file set NODE_ENV, so it never fired.
//
// Outside development the variable is mandatory and the process refuses to boot
// without it. In development a random key is minted per boot: sessions die when
// the server restarts, which is a fair price for having no guessable secret
// anywhere in the tree.
const DEV = process.env.NODE_ENV === 'development';
// Every value that has ever been published in this repository as an example.
// `cambia-esto-por-32-bytes-aleatorios` was the worst of them: it shipped in
// api/.env.example and is 35 characters, so it passed the length check and
// worked as a real signing key. A signing key in the repository means anyone who
// can read the repo can mint an admin session. The example file now ships the
// secrets EMPTY so copying it fails instead of appearing to work; this list
// exists for the people who already copied it.
//
// Enumeration is the weaker half of the fix and always lags. The structural half
// is that no example file may contain a value long enough to pass.
const WEAK = new Set([
  'dev-only-change-me',
  'dev-solo-para-local',
  'changeme',
  'secret',
  'cambia-esto-por-32-bytes-aleatorios',
  'change-this-for-32-random-bytes',
]);

function sessionKey(): string {
  const given = process.env.JWT_SECRET;
  if (given) {
    if (WEAK.has(given)) {
      throw new Error(`JWT_SECRET is a known placeholder ('${given}'). Sessions signed with it are forgeable by anyone who can read this repository. Run scripts/keys.sh.`);
    }
    if (given.length < 32) {
      throw new Error(`JWT_SECRET is ${given.length} chars; 32 or more required. Run scripts/keys.sh.`);
    }
    return given;
  }
  if (!DEV) {
    throw new Error('JWT_SECRET is required. Set NODE_ENV=development for an ephemeral key, or run scripts/keys.sh.');
  }
  const minted = randomBytes(32).toString('base64url');
  console.warn('[auth] JWT_SECRET unset — minted an ephemeral development key. Every restart invalidates all sessions.');
  return minted;
}

const SECRET = sessionKey();

const b64 = (buf: Uint8Array | string): string => Buffer.from(buf as Uint8Array).toString('base64url');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64url');

// ---------------------------------------------------------------------------
// PASSWORD HASHING
//
// Two things were wrong and they had to be fixed together.
//
// 1. scryptSync ran the KDF ON THE CALLING THREAD. Node has one of those, so
//    every login froze the whole server — health checks, lessons, chat, other
//    people's logins — for the duration of the derivation. Ten concurrent logins
//    were ten serialised freezes: a cheap availability attack that needs no
//    valid account, only the login form. The async form hands the work to
//    libuv's thread pool and the event loop keeps turning.
//
// 2. The cost was Node's default (N=16384). Current OWASP guidance for scrypt is
//    N=2^17, r=8, p=1. Raising it makes problem 1 eight times worse, which is
//    why neither change ships alone.
//
// Measured on the dev machine: N=16384 -> 24 ms, N=131072 -> 197 ms.
interface Cost { N: number; r: number; p: number }

const KDF: Cost = { N: 131072, r: 8, p: 1 };
const KEYLEN = 64;

// Node's scrypt refuses to run when 128 * N * r exceeds maxmem, and the default
// maxmem is 32 MiB — one quarter of the 128 MiB that N=2^17 needs. Without this
// the call THROWS instead of hashing, so it is declared with room to spare.
const maxmem = (N: number, r: number): number => 128 * N * r * 2;

// How many derivations may run at once.
//
// Unbounded async scrypt is a memory bomb: each call at N=2^17 holds ~128 MiB,
// so twenty simultaneous logins would ask for 2.5 GiB and the process dies. This
// gate lets LIMIT run and makes the rest WAIT — a flood queues instead of
// exhausting memory. It also protects the thread pool: UV_THREADPOOL_SIZE is 4
// by default and filling it with KDF work starves fs and dns for everyone.
const LIMIT = Math.max(1, Number(process.env.KDF_MAX_CONCURRENT ?? 2));
let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  // `while`, not `if`: a woken waiter re-checks instead of assuming the slot is
  // still free, so the limit holds even when several wake in the same tick.
  while (running >= LIMIT) await new Promise<void>((r) => { waiting.push(r); });
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

// Wrapped by hand rather than with promisify.
//
// promisify() collapses to scrypt's 3-argument overload, so passing the options
// object is a type error (TS2554) even though it is exactly what has to be passed.
// Silencing that with a cast would hide the one mistake that matters here: drop
// the options and the KDF quietly runs at Node's default N=16384 instead of 2^17,
// with nothing failing. Measured, the options do apply — 257 ms vs 28 ms, and
// omitting maxmem raises ERR_CRYPTO_INVALID_SCRYPT_PARAMS — so the call is right
// and it is the promise wrapper that needed fixing.
const derive = (plain: string, salt: Buffer, c: Cost, keylen: number): Promise<Buffer> =>
  withSlot(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(String(plain), salt, keylen, { N: c.N, r: c.r, p: c.p, maxmem: maxmem(c.N, c.r) },
      (err, key) => (err ? reject(err) : resolve(key)));
  }));

// Node's own defaults, which is what the 3-field rows in the database were
// written with. They carry no parameters, so the parameters have to be assumed —
// and that is exactly why the new format writes them down.
const LEGACY: Cost = { N: 16384, r: 8, p: 1 };

interface Stored { cost: Cost; salt: Buffer; key: Buffer }

// Stored format, backward compatible in one direction on purpose:
//
//   scrypt$<salt>$<key>                     old rows, read only, assumed LEGACY
//   scrypt$N=131072,r=8,p=1$<salt>$<key>    written from now on
//
// The parameters live IN the string because the cost will be raised again. A row
// written at one cost has to keep verifying after the constant moves, and a
// single global constant cannot do that. base64 never contains '$', so splitting
// on it is unambiguous.
function parseStored(stored: unknown): Stored | null {
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt') return null;
  let cost: Cost | null = null, saltB64: string | undefined, keyB64: string | undefined;
  if (parts.length === 3) { cost = LEGACY; saltB64 = parts[1]; keyB64 = parts[2]; }
  else if (parts.length === 4) { cost = parseCost(parts[1]); saltB64 = parts[2]; keyB64 = parts[3]; }
  if (!cost || !saltB64 || !keyB64) return null;
  const key = Buffer.from(keyB64, 'base64');
  const salt = Buffer.from(saltB64, 'base64');
  if (!key.length || !salt.length) return null;
  return { cost, salt, key };
}

// Bounded on purpose. These numbers come out of the database and go straight
// into an allocation: an N of 2^30 in a tampered row is a request for 1 TiB.
function parseCost(spec: unknown): Cost | null {
  const out: Record<string, number> = {};
  for (const kv of String(spec).split(',')) {
    const [k, v] = kv.split('=');
    if (k) out[k] = Number(v);
  }
  const { N, r, p } = out;
  if (!Number.isInteger(N) || N < 1024 || N > 1048576 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;
  return { N, r, p };
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(plain, salt, KDF, KEYLEN);
  return `scrypt$N=${KDF.N},r=${KDF.r},p=${KDF.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: unknown): Promise<boolean> {
  const s = parseStored(stored);
  if (!s) return false;
  const test = await derive(plain, s.salt, s.cost, s.key.length);
  return s.key.length === test.length && timingSafeEqual(s.key, test);
}

// Burn one derivation against a hash whose password nobody holds, and answer
// false. This exists so that "no such account" costs the same as "wrong
// password": verifyPassword only ran when the row was found, so an unknown
// address answered in half the time (26 ms vs 52 ms, measured) and that
// difference alone told an attacker which addresses have accounts.
//
// The decoy is minted at the CURRENT cost, so it matches what registrations
// write today. Residual leak, stated: a row still stored at LEGACY cost verifies
// faster than the decoy, so timing can distinguish "old account" from
// "no account". That is a hash-generation marker, not account existence, and it
// closes for a row the next time its password is written.
let decoy: Promise<string> | null = null;
export function spendKdf(plain: string): Promise<boolean> {
  decoy ??= hashPassword(randomBytes(32).toString('base64'));
  return decoy.then((h) => verifyPassword(plain, h));
}

/** What a signed session carries. `v` is users.token_version at signing time. */
export interface SessionClaims {
  sub: number;
  role: string;
  v: number;
}

export type SignedSession = SessionClaims & { iat: number; exp: number };

export function sign(payload: SessionClaims, ttlSeconds = 60 * 60 * 12): string {
  const body: SignedSession = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64(JSON.stringify(body))}`;
  const sig = b64(createHmac('sha256', SECRET).update(data).digest());
  return `${data}.${sig}`;
}

export function verify(token: unknown): SignedSession | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', SECRET).update(data).digest();
  const got = unb64(parts[2]!);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let body: SignedSession;
  try { body = JSON.parse(unb64(parts[1]!).toString('utf8')) as SignedSession; } catch { return null; }
  if (typeof body.exp !== 'number' || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

export const COOKIE = 'sid';
// The literal type is not cosmetic: without it `sameSite` widens to `string`, and
// one day somebody writes 'Lax' or 'lx' and it still compiles — the cookie ships
// with no CSRF protection and nothing warns. With the literal, anything that is
// not one of the three is a type error. tsgo flagged it (TS2345, three setCookie
// calls).
export interface CookieOpts {
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
}

export const cookieOpts: CookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 12,
};

// Password recovery: the link carries the token in the clear, the database stores
// only its hash. Comparing hashes means a database dump is not a way in.
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (t: unknown): string => createHash('sha256').update(String(t)).digest('hex');
export const TOKEN_MINUTES = 30;
