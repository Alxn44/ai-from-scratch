FROM node:22-alpine AS build

ARG PUBLIC_SITE=http://localhost:4321
ENV PUBLIC_SITE=${PUBLIC_SITE}

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 4321

# Drop root, same reasoning as api/Dockerfile: the `node` user ships with the
# image, /app stays root-owned and read-only to the process, and the Astro
# standalone server writes nothing at runtime.
USER node
CMD ["node", "dist/server/entry.mjs"]
