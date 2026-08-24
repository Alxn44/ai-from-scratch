// Prisma 7 moved the connection URL out of schema.prisma and into this file.
//
// Only the CLI reads it. Nothing at runtime does: there is no @prisma/client in
// this project and no query engine in the image. Prisma's job here is schema
// ownership and migration generation; every query is native SQL through `pg`.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: env('DATABASE_URL'),
    // Prisma replays the migrations directory into this throwaway database to
    // compare it against the real one. Without it, drift detection cannot run at
    // all — and drift detection is most of the reason to adopt Prisma here.
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});
