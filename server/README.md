# Synapse Server 运维说明

本文只记录后端服务的安装、启动、构建、发布、部署和数据同步流程。

## 目录位置

后端是 monorepo 里的 workspace package：

```text
server/
```

包名：

```text
@synapse/server
```

所有命令默认在仓库根目录执行，除非特别说明。

## 环境要求

- Node.js 22 或兼容版本
- pnpm 10.22.0
- PostgreSQL 16+
- Docker / Docker Compose，部署或本地容器启动时需要

首次安装依赖：

```bash
pnpm install --frozen-lockfile
```

如果刚拉取代码后 Prisma Client 不存在，先生成：

```bash
DATABASE_URL=postgresql://synapse:synapse@localhost:5432/synapse \
  pnpm --filter @synapse/server prisma:generate
```

## 环境变量

复制示例文件：

```bash
cp server/.env.example server/.env
```

必填项：

```bash
DATABASE_URL=postgresql://synapse:synapse@localhost:5432/synapse
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-now
ADMIN_JWT_SECRET=replace-with-at-least-16-characters
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
LICENSE_KEY_ID=local-dev-key
LICENSE_LEASE_DAYS=7
PORT=3000
```

生成 Ed25519 授权签名密钥：

```bash
node -e "const {generateKeyPairSync}=require('crypto'); const {privateKey,publicKey}=generateKeyPairSync('ed25519'); console.log('LICENSE_PRIVATE_KEY='+JSON.stringify(privateKey.export({type:'pkcs8',format:'pem'}))); console.log('LICENSE_PUBLIC_KEY='+JSON.stringify(publicKey.export({type:'spki',format:'pem'})));"
```

输出可以直接粘贴到 `.env`。服务会把 `\n` 转成真实 PEM 换行。

生产环境要替换：

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_JWT_SECRET`
- `LICENSE_PRIVATE_KEY`
- `LICENSE_PUBLIC_KEY`
- `LICENSE_KEY_ID`
- `DATABASE_URL`

`LICENSE_PRIVATE_KEY` 只放在服务端。桌面端通过服务端返回的 public key 验证离线租约。

## 本地启动：Docker

推荐用显式 env file，避免 Docker Compose 在不同目录下读取不到 `server/.env`：

```bash
docker compose --env-file server/.env -f server/compose.yml up --build
```

也可以把 `LICENSE_PRIVATE_KEY` / `LICENSE_PUBLIC_KEY` 等变量先导入当前 shell，再使用根脚本：

```bash
set -a
source server/.env
set +a
pnpm server:docker:up
```

容器启动时会执行：

```bash
pnpm --filter @synapse/server prisma:migrate
pnpm --filter @synapse/server start
```

本地访问：

```text
http://localhost:3000/admin
```

PostgreSQL 数据存储在 Docker volume：

```text
synapse-postgres
```

查看服务日志：

```bash
docker compose -f server/compose.yml logs -f server
docker compose -f server/compose.yml logs -f postgres
```

停止服务但保留数据：

```bash
docker compose -f server/compose.yml down
```

删除本地数据库 volume：

```bash
docker compose -f server/compose.yml down -v
```

## 本地启动：不用 Docker

先启动自己的 PostgreSQL，并确保 `DATABASE_URL` 可连接。

加载环境变量：

```bash
set -a
source server/.env
set +a
```

部署已有迁移：

```bash
pnpm --filter @synapse/server prisma:migrate
```

启动开发模式：

```bash
pnpm server:dev
```

开发模式会监听后端源码变化。管理后台仍需要通过构建产物提供静态文件；需要更新后台页面时执行：

```bash
pnpm --filter @synapse/server build:admin
```

## 数据库迁移

开发新 schema 时创建迁移：

```bash
pnpm --filter @synapse/server prisma:dev
```

生产或容器部署时只执行已有迁移：

```bash
pnpm --filter @synapse/server prisma:migrate
```

检查 Prisma schema：

```bash
DATABASE_URL=postgresql://synapse:synapse@localhost:5432/synapse \
  pnpm --filter @synapse/server exec prisma validate
```

重新生成 Prisma Client：

```bash
pnpm --filter @synapse/server prisma:generate
```

## 构建

完整构建：

```bash
pnpm server:build
```

等价于：

```bash
pnpm --filter @synapse/server build:api
pnpm --filter @synapse/server build:admin
```

输出目录：

```text
server/dist
server/admin-dist
```

这两个目录是构建产物，不提交。

## 验证

后端测试：

```bash
pnpm --filter @synapse/server test
```

管理后台页面测试：

```bash
pnpm --filter @synapse/server test:admin
```

类型检查：

```bash
pnpm --filter @synapse/server typecheck
```

构建验证：

```bash
pnpm --filter @synapse/server build
```

## 发布 Docker 镜像

从仓库根目录构建：

```bash
docker build -f server/Dockerfile -t synapse-server:latest .
```

打版本标签：

```bash
docker tag synapse-server:latest registry.example.com/synapse-server:0.1.0
```

推送镜像：

```bash
docker push registry.example.com/synapse-server:0.1.0
```

镜像内包含：

- API 构建产物 `server/dist`
- 管理后台构建产物 `server/admin-dist`
- Prisma schema 和 migrations
- workspace 运行依赖

镜像启动命令默认是：

```bash
pnpm --filter @synapse/server start
```

生产部署前需要先执行迁移，推荐在部署脚本或容器 command 里执行：

```bash
pnpm --filter @synapse/server prisma:migrate
pnpm --filter @synapse/server start
```

## 服务器部署

最小部署需要两个服务：

- PostgreSQL
- Synapse server

生产环境建议用独立 Postgres volume 或云数据库，不要把数据库放进一次性应用容器。

示例 `docker-compose.yml`：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: synapse
      POSTGRES_PASSWORD: change-this-password
      POSTGRES_DB: synapse
    volumes:
      - synapse-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U synapse -d synapse"]
      interval: 5s
      timeout: 5s
      retries: 10

  server:
    image: registry.example.com/synapse-server:0.1.0
    environment:
      DATABASE_URL: postgresql://synapse:change-this-password@postgres:5432/synapse
      ADMIN_EMAIL: admin@example.com
      ADMIN_PASSWORD: change-me-now
      ADMIN_JWT_SECRET: replace-with-at-least-16-characters
      LICENSE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
      LICENSE_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
      LICENSE_KEY_ID: production-key-2026-04
      LICENSE_LEASE_DAYS: "7"
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    command: sh -c "pnpm --filter @synapse/server prisma:migrate && pnpm --filter @synapse/server start"

volumes:
  synapse-postgres:
```

如果前面有 Nginx / Caddy / CDN，反向代理到容器的 `3000` 端口即可。

健康检查可以直接请求：

```bash
curl http://localhost:3000/v1/license/config
```

## 升级流程

推荐顺序：

1. 在本地或 CI 构建新镜像。
2. 推送镜像到 registry。
3. 备份生产数据库。
4. 部署新镜像。
5. 执行 `prisma:migrate`。
6. 启动服务。
7. 检查 `/v1/license/config` 和 `/admin`。

生产数据库备份：

```bash
pg_dump "$DATABASE_URL" -Fc -f synapse-$(date +%Y%m%d-%H%M%S).dump
```

回滚应用版本时，先切回旧镜像。数据库迁移是否可回滚取决于 migration 内容，发布前要保留备份。

## 数据备份

Docker 本地导出：

```bash
docker compose -f server/compose.yml exec postgres \
  pg_dump -U synapse -d synapse -Fc -f /tmp/synapse.dump

docker compose -f server/compose.yml cp \
  postgres:/tmp/synapse.dump ./synapse.dump
```

使用 `DATABASE_URL` 导出：

```bash
pg_dump "$DATABASE_URL" -Fc -f ./synapse.dump
```

恢复到目标数据库：

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname "$DATABASE_URL" ./synapse.dump
```

恢复到 Docker 本地 Postgres：

```bash
docker compose -f server/compose.yml cp ./synapse.dump postgres:/tmp/synapse.dump

docker compose -f server/compose.yml exec postgres \
  pg_restore --clean --if-exists --no-owner \
  -U synapse -d synapse /tmp/synapse.dump
```

## 数据同步

本地同步到服务器：

```bash
pg_dump "postgresql://synapse:synapse@localhost:5432/synapse" -Fc -f ./synapse-local.dump
pg_restore --clean --if-exists --no-owner --dbname "$SERVER_DATABASE_URL" ./synapse-local.dump
```

服务器同步回本地：

```bash
pg_dump "$SERVER_DATABASE_URL" -Fc -f ./synapse-server.dump
pg_restore --clean --if-exists --no-owner \
  --dbname "postgresql://synapse:synapse@localhost:5432/synapse" \
  ./synapse-server.dump
```

如果本地 Postgres 运行在 Docker Compose 中：

```bash
docker compose -f server/compose.yml cp ./synapse-server.dump postgres:/tmp/synapse-server.dump

docker compose -f server/compose.yml exec postgres \
  pg_restore --clean --if-exists --no-owner \
  -U synapse -d synapse /tmp/synapse-server.dump
```

同步会覆盖目标库中的同名对象。执行前先确认目标库可以被覆盖。

桌面端只保存签名后的离线租约，不会同步完整后端数据库。完整数据以 PostgreSQL 为准。

## 常用排查命令

查看迁移状态：

```bash
pnpm --filter @synapse/server exec prisma migrate status
```

查看数据库表：

```bash
pnpm --filter @synapse/server exec prisma studio
```

检查端口：

```bash
lsof -i :3000
```

检查容器状态：

```bash
docker compose -f server/compose.yml ps
```

查看容器内环境变量：

```bash
docker compose -f server/compose.yml exec server env | sort
```

## 敏感信息

不要提交：

- `server/.env`
- 数据库 dump
- 私钥
- 生产管理员密码
- 生产数据库连接串

已经加入忽略：

```text
server/.env
server/.env.local
*.env.local
```
