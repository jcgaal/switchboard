# syntax=docker/dockerfile:1

# The first stage installs every dependency and builds the server
# bundle and the dashboard. The second stage keeps the runtime
# packages only, so the final image has no build toolchain.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 AGENTS_DIR=/app/agents
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY agents ./agents

# Private agents are mounted over /app/agents or anywhere else,
# with AGENTS_DIR pointing at them, so they never have to be
# baked into an image that might be pushed to a registry.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
