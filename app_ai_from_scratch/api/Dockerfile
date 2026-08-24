# ---------------------------------------------------------------------------
# build: the sources are TypeScript and the compiler is a devDependency, so the
# emit needs its own stage — the runtime image installs with --prod, which prunes
# tsgo, and the migrate stage should not carry a compiler it does not use.
#
# Only package.json, the lockfile, tsconfig and src/ are copied, so a change to
# a test or a doc does not invalidate this layer.
#
# `rootDir` is pinned in tsconfig.json on purpose. tsgo infers it from the files
# it actually finds, so a build tree holding only src/ — which is exactly what
# this stage copies — infers ./src and fails with TS5011. With it pinned, the
# entrypoint is dist/src/server.js whether or not test/ and scripts/ are present.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---------------------------------------------------------------------------
# migrate: carries the Prisma CLI. Used by the one-shot `init` service in
# docker-compose to apply the schema and seed content BEFORE any API starts.
#
# It is a separate stage because the runtime image installs with --prod, which
# prunes the CLI. And it is a separate SERVICE because two API instances booting
# at once would otherwise both run DDL against one database.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS migrate

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
USER node
CMD ["sh", "-c", "pnpm db:deploy && node dist/src/seed.js"]

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787

# Drop root. node:22-alpine already ships uid/gid 1000 as `node`, so there is
# nothing to create. /app deliberately stays root-owned: the process needs to
# READ its code, never to write it. An RCE that lands as `node` therefore
# cannot patch dist/ to survive a restart, and cannot rewrite node_modules to
# backdoor a dependency. Nothing under /app is written at runtime.
USER node
CMD ["node", "dist/src/server.js"]
