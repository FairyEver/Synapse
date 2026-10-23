ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:22.23.4-bookworm-slim AS build
ARG NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY NPM_CONFIG_REGISTRY=$NPM_REGISTRY
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY pdf-renderer/package.json pdf-renderer/package.json
RUN pnpm install --frozen-lockfile --filter @synapse/pdf-renderer...
COPY pdf-renderer pdf-renderer
RUN pnpm --filter @synapse/pdf-renderer run build

FROM node:24.22.1-bookworm-slim AS node-runtime

FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app
# Playwright 镜像提供 Chromium；最终 Node 运行时独立固定到安全版本。
COPY --from=node-runtime /usr/local/bin/node /usr/bin/node
COPY scripts/deploy/check-node-runtime.mjs scripts/deploy/check-node-runtime.mjs
RUN node scripts/deploy/check-node-runtime.mjs
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 synapse
COPY --from=build /workspace/node_modules /app/node_modules
COPY --from=build /workspace/pdf-renderer/node_modules /app/pdf-renderer/node_modules
COPY --from=build /workspace/pdf-renderer/dist /app/pdf-renderer/dist
USER 10001:10001
ENV NODE_ENV=production PORT=3010 HOME=/tmp XDG_CONFIG_HOME=/tmp/.config XDG_CACHE_HOME=/tmp/.cache
EXPOSE 3010
CMD ["node", "/app/pdf-renderer/dist/main.js"]
