# Synapse Server 启动说明

后端在 monorepo 的 `server/` 包里，包名是 `@synapse/server`。

所有命令默认在仓库根目录执行：

```bash
cd /Users/liyang/Documents/code/github/Synapse
```

## 先看结论

日常改后端或管理后台代码，用一个命令启动数据库、执行迁移、进入 Nest watch，并启动管理后台 Vite 热更新：

```bash
pnpm dev
```

改 `server/src/**` 后会自动重启；改 `server/admin/src/**` 后会通过 Vite HMR 更新页面，不需要重新 build。

只有验证生产镜像时才用：

```bash
docker compose --env-file server/.env -f server/compose.yml up --build
```

这个命令会重新构建 Docker 镜像，所以慢是正常的。

## 环境要求

- Node.js 22 或兼容版本
- pnpm 10.22.0
- Docker / Docker Compose

首次安装依赖：

```bash
pnpm install --frozen-lockfile
```

## 第一次准备 `.env`

复制示例文件：

```bash
cp server/.env.example server/.env
```

生成授权签名密钥：

```bash
node -e "const {generateKeyPairSync}=require('crypto'); const {privateKey,publicKey}=generateKeyPairSync('ed25519'); console.log('LICENSE_PRIVATE_KEY='+JSON.stringify(privateKey.export({type:'pkcs8',format:'pem'}))); console.log('LICENSE_PUBLIC_KEY='+JSON.stringify(publicKey.export({type:'spki',format:'pem'})));"
```

把输出的 `LICENSE_PRIVATE_KEY=...` 和 `LICENSE_PUBLIC_KEY=...` 粘贴到 `server/.env`，替换示例里的占位值。

不要反复执行 `cp server/.env.example server/.env`，它会覆盖已经生成好的本地密钥。

## 如果本机 5432 已被 PostgreSQL 占用

如果启动时报：

```text
Ports are not available: exposing port TCP 0.0.0.0:5432
```

说明本机已有 PostgreSQL 占用 `5432`。把 `server/.env` 改成：

```env
DATABASE_URL=postgresql://synapse:synapse@localhost:5433/synapse
POSTGRES_HOST_PORT=5433
```

含义：

- `POSTGRES_HOST_PORT=5433`：Docker 里的 PostgreSQL 映射到本机 `5433`
- `DATABASE_URL=...localhost:5433...`：本机运行的后端连接 Docker 数据库

Docker 容器内部仍然使用 `postgres:5432`，不需要改 `server/compose.yml`。

## 日常开发启动

```bash
pnpm dev
```

这个命令会依次执行：

- `docker compose --env-file server/.env -f server/compose.yml up -d postgres`
- `pnpm --filter @synapse/server run prisma:migrate`
- `pnpm --filter @synapse/server run dev`

开发模式下 `localhost:3000` 由 Vite 提供管理后台页面并代理 API，Nest API 运行在 `localhost:3001`。

如果数据库已经启动、迁移也已经跑过，只想单独启动 API watch：

```bash
set -a; . server/.env; set +a; PORT=${SYNAPSE_SERVER_API_PORT:-3001} pnpm --filter @synapse/server run dev:api
```

访问：

```text
http://localhost:3000/admin/
```

默认管理员账号来自 `server/.env`：

```text
admin@d2.com
admin@pwd
```

后台新建激活码时只填写设备数和到期日。激活码必须由服务端生成，创建成功后页面会显示生成结果。

## 激活风控配置

授权服务会记录激活尝试，并按 IP、邮箱、设备和激活码做短窗口风控。默认配置适合自部署的平衡档：

- 尝试记录默认保留 90 天。
- 单来源短时失败过多会临时拒绝激活。
- 同一激活码在短时间内出现多个邮箱、设备或 IP 会进入风控锁定。
- 风控锁定只拦截新激活，不影响已激活设备续租。

可通过 `ACTIVATION_*` 环境变量调整阈值。

检查 API：

```bash
curl http://localhost:3000/v1/license/config
```

停止开发服务：在 `pnpm dev` 的终端按 `Ctrl+C`，或执行 `pnpm quit`。

停止数据库：

```bash
docker compose -f server/compose.yml down
```

## 生产镜像验证

完整 Docker 启动：

```bash
docker compose --env-file server/.env -f server/compose.yml up --build
```

这个命令会：

- 读取 `server/.env`
- 构建后端 API
- 构建管理后台
- 构建 Docker 镜像
- 启动 PostgreSQL 和 server 容器
- 在容器里执行 Prisma 迁移

适合发版前验证，不适合每次改代码后使用。

停止：

```bash
docker compose -f server/compose.yml down
```

删除本地数据库 volume：

```bash
docker compose -f server/compose.yml down -v
```

## 常用命令

后端测试：

```bash
pnpm --filter @synapse/server run test
```

类型检查：

```bash
pnpm --filter @synapse/server run typecheck
```

完整构建：

```bash
pnpm --filter @synapse/server run build
```

只构建 API：

```bash
pnpm --filter @synapse/server run build:api
```

只构建管理后台：

```bash
pnpm --filter @synapse/server run build:admin
```

查看容器状态：

```bash
docker compose -f server/compose.yml ps
```

查看服务日志：

```bash
docker compose -f server/compose.yml logs -f server
```

查看数据库日志：

```bash
docker compose -f server/compose.yml logs -f postgres
```

检查端口：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:5432 -sTCP:LISTEN
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

## Prisma

开发新 schema 时创建迁移：

```bash
set -a
. server/.env
set +a
pnpm --filter @synapse/server prisma:dev
```

重新生成 Prisma Client：

```bash
pnpm --filter @synapse/server prisma:generate
```

检查 schema：

```bash
set -a
. server/.env
set +a
pnpm --filter @synapse/server exec prisma validate
```

## 发布镜像

从仓库根目录构建：

```bash
docker build -f server/Dockerfile -t synapse-server:latest .
```

打版本标签：

```bash
docker tag synapse-server:latest registry.example.com/synapse-server:0.1.0
```

推送：

```bash
docker push registry.example.com/synapse-server:0.1.0
```

镜像内包含：

- API 构建产物 `server/dist`
- 管理后台构建产物 `server/admin-dist`
- Prisma schema 和 migrations
- workspace 运行依赖

生产启动时需要先执行迁移，再启动服务：

```bash
pnpm --filter @synapse/server prisma:migrate
pnpm --filter @synapse/server start
```

## 生产部署示例

最小部署需要 PostgreSQL 和 Synapse server。

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
      ADMIN_EMAIL: admin@d2.com
      ADMIN_PASSWORD: admin@pwd
      ADMIN_JWT_SECRET: qwer1234asdf5678
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

反向代理到容器的 `3000` 端口即可。

健康检查：

```bash
curl http://localhost:3000/v1/license/config
```

## 备份和恢复

导出 Docker 本地数据库：

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

恢复：

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname "$DATABASE_URL" ./synapse.dump
```

## 常见问题

### 改代码后要重新 build 吗

日常开发不用。使用：

```bash
pnpm dev
```

`pnpm dev` 会启动 Vite HMR。只有生产镜像验证才需要 build。

### `Cannot find module '/app/server/dist/main.js'`

说明 Docker 镜像里的 API 构建产物路径不对。当前构建配置应输出：

```text
server/dist/main.js
```

先跑：

```bash
pnpm --filter @synapse/server build:api
test -f server/dist/main.js && echo ok
```

### `/admin/` 打开是白屏

先看页面里的资源路径：

```bash
curl http://localhost:3000/admin/
```

构建后的 JS/CSS 应该是 `/admin/assets/...`：

```html
<script type="module" crossorigin src="/admin/assets/..."></script>
<link rel="stylesheet" crossorigin href="/admin/assets/...">
```

如果看到 `/assets/...`，说明管理后台 Vite base 配置不对，浏览器会请求不存在的根路径资源并白屏。

### `DATABASE_URL` 连不上

如果本机用 Docker 数据库且 `POSTGRES_HOST_PORT=5433`，`server/.env` 也要用 `localhost:5433`：

```env
DATABASE_URL=postgresql://synapse:synapse@localhost:5433/synapse
POSTGRES_HOST_PORT=5433
```

### `5432` 端口被占用

查看是谁占用：

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
```

不建议为了 Synapse 直接停掉本机 PostgreSQL。优先把 Docker 数据库映射到 `5433`。

## 敏感信息

不要提交：

- `server/.env`
- 数据库 dump
- 私钥
- 生产管理员密码
- 生产数据库连接串

已忽略：

```text
server/.env
server/.env.local
*.env.local
```
