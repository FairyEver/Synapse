FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches/ patches/
COPY shared/package.json shared/package.json
COPY ui/package.json ui/package.json
COPY server/package.json server/package.json
COPY dashboard/package.json dashboard/package.json
RUN pnpm install --frozen-lockfile --filter @synapse/shared --filter @synapse/server... --filter @synapse/dashboard...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/ui/node_modules ./ui/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules
COPY server/ server/
COPY dashboard/ dashboard/
COPY shared/ shared/
COPY ui/ ui/
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm --filter @synapse/server prisma:generate
RUN pnpm --filter @synapse/server build
RUN pnpm --filter @synapse/dashboard build

FROM base AS production
ENV NODE_ENV=production
RUN apk add --no-cache nginx postgresql16-client
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/dashboard/dist ./dashboard/dist
COPY --from=build /app/shared ./shared
COPY server/prisma ./server/prisma
COPY server/docker-entrypoint.sh ./server/docker-entrypoint.sh
COPY server/package.json ./server/package.json
COPY server/nginx.conf /etc/nginx/http.d/default.conf
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
EXPOSE 3000
CMD ["sh", "server/docker-entrypoint.sh"]
