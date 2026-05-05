FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json server/package.json
COPY server/admin/package.json server/admin/package.json
RUN pnpm install --frozen-lockfile --filter @synapse/server...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/server/admin/node_modules ./server/admin/node_modules
COPY server/ server/
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm --filter @synapse/server prisma:generate
RUN pnpm --filter @synapse/server build

FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/admin-dist ./server/admin-dist
COPY --from=build /app/server/node_modules/.prisma ./server/node_modules/.prisma
COPY server/prisma ./server/prisma
COPY server/package.json ./server/package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
WORKDIR /app
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
