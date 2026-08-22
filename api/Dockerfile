FROM node:22-alpine

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY src ./src

ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "src/server.js"]
