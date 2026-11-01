ARG NPM_REGISTRY=https://registry.npmmirror.com
# 默认构建 Dashboard V2；显式传入 v1 保留旧版回滚能力。
ARG DASHBOARD_UI=v2

FROM node:22.23.4-alpine AS base
ARG NPM_REGISTRY
ARG DASHBOARD_UI
RUN COREPACK_NPM_REGISTRY="$NPM_REGISTRY" corepack enable \
  && COREPACK_NPM_REGISTRY="$NPM_REGISTRY" corepack prepare pnpm@12.16.1 --activate
WORKDIR /app
COPY scripts/deploy/check-node-runtime.mjs scripts/deploy/check-node-runtime.mjs
COPY scripts/deploy/dashboard-ui.mjs scripts/deploy/dashboard-ui.mjs
RUN node scripts/deploy/check-node-runtime.mjs
RUN node scripts/deploy/dashboard-ui.mjs "$DASHBOARD_UI" >/dev/null

FROM base AS deps
ARG NPM_REGISTRY
ENV PNPM_CONFIG_REGISTRY=$NPM_REGISTRY
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .pnpmfile.cjs ./
COPY patches/ patches/
COPY shared/package.json shared/package.json
COPY ui/package.json ui/package.json
COPY document/package.json document/package.json
COPY server/package.json server/package.json
COPY dashboard/package.json dashboard/package.json
COPY dashboard-v2/package.json dashboard-v2/package.json
COPY pdf-renderer/package.json pdf-renderer/package.json
RUN pnpm install --frozen-lockfile --filter @synapse/shared --filter @synapse/server... --filter @synapse/dashboard... --filter @synapse/dashboard-v2... --filter @synapse/document...

FROM base AS build
ARG APP_PUBLIC_URL=https://synapse.d2.pub
ARG DASHBOARD_UI
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/ui/node_modules ./ui/node_modules
COPY --from=deps /app/document/node_modules ./document/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules
COPY --from=deps /app/dashboard-v2/node_modules ./dashboard-v2/node_modules
COPY server/ server/
COPY dashboard/ dashboard/
COPY dashboard-v2/ dashboard-v2/
COPY document/ document/
COPY shared/ shared/
COPY ui/ ui/
COPY pdf-renderer/package.json pdf-renderer/package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .pnpmfile.cjs ./
RUN pnpm --filter @synapse/server prisma:generate
RUN pnpm --filter @synapse/server build
RUN pnpm --filter "$(node scripts/deploy/dashboard-ui.mjs "$DASHBOARD_UI" package)" build \
  && mkdir -p /app/dashboard-artifact \
  && cp -a "$(node scripts/deploy/dashboard-ui.mjs "$DASHBOARD_UI" directory)/dist/." /app/dashboard-artifact/ \
  && node scripts/deploy/dashboard-ui.mjs "$DASHBOARD_UI" json > /app/dashboard-artifact/dashboard-ui.json
RUN APP_PUBLIC_URL=$APP_PUBLIC_URL pnpm --filter @synapse/document build

FROM base AS production
ENV NODE_ENV=production
# 默认 CDN 不可达时使用镜像节点，保留 APK 签名校验，并限制每轮安装总耗时。
RUN timeout -k 5 90 apk add --no-cache --timeout 30 nginx postgresql16-client \
  || (sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
      && timeout -k 5 180 apk add --no-cache --timeout 30 nginx postgresql16-client)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dashboard-artifact ./dashboard/dist
COPY --from=build /app/document/.vitepress/dist ./document
COPY --from=build /app/shared ./shared
COPY server/prisma ./server/prisma
COPY server/docker-entrypoint.sh ./server/docker-entrypoint.sh
COPY server/package.json ./server/package.json
COPY server/nginx.conf /etc/nginx/http.d/default.conf
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
EXPOSE 3000
CMD ["sh", "server/docker-entrypoint.sh"]
