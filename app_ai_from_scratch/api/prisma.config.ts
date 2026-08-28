// Prisma 7 moved the connection URL out of schema.prisma and into this file.
//
// Only the CLI reads it. Nothing at runtime does: there is no @prisma/client in
// this project and no query engine in the image. Prisma's job here is schema
// ownership and migration generation; every query is native SQL through `pg`.
import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Keep an explicit DATABASE_URL from CI/tests authoritative. The developer
// file is only a fallback for local Prisma commands and must never replace an
// isolated test database supplied by the caller.
const explicitDatabaseUrl = process.env.DATABASE_URL;
const explicitShadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;
loadDotenv({ path: new URL('.env', import.meta.url) });
if (explicitDatabaseUrl) process.env.DATABASE_URL = explicitDatabaseUrl;
if (explicitShadowDatabaseUrl) process.env.SHADOW_DATABASE_URL = explicitShadowDatabaseUrl;
// When a caller supplies an isolated database but no shadow URL, never fall
// back to the developer machine's stale shadow host (and never alias the main
// database as its shadow). Prisma can provision its own temporary shadow. An
// explicit shadow URL still wins; with no explicit main URL, .env is the local
// fallback for both values.
if (explicitDatabaseUrl && !explicitShadowDatabaseUrl) delete process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: env('DATABASE_URL'),
    // Prisma replays the migrations directory into this throwaway database to
    // compare it against the real one. Without it, drift detection cannot run at
    // all — and drift detection is most of the reason to adopt Prisma here.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ? env('SHADOW_DATABASE_URL') : undefined,
  },
});
