FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY pdf-renderer/package.json pdf-renderer/package.json
RUN pnpm install --frozen-lockfile --filter @synapse/pdf-renderer...
COPY pdf-renderer pdf-renderer
RUN pnpm --filter @synapse/pdf-renderer run build

FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /app
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
