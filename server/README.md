# Synapse Server

Synapse 后端服务，包含 API 和 Admin 管理后台。

## 账号与团队

- 首次启动时，服务会用 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 创建唯一平台管理员；已有管理员时不会覆盖。
- 管理员通过 Admin 后台创建一次性注册邀请。
- 普通账号通过 `/api/auth/register` 注册，通过 `/api/auth/login` 登录。
- 普通账号会获得 access token 和 refresh token。
- 普通账号可以创建一个团队，或通过一次性团队邀请加入一个团队。

## 技术栈

- NestJS 11 + TypeScript
- PostgreSQL 16 + Prisma ORM
- Admin 后台：React 19 + Vite + shadcn/ui

## 本地开发

```bash
# 在项目根目录
pnpm dev:server
```

自动启动 Postgres 容器、运行迁移、启动 API 和 Admin 开发服务器。

---

## 生产部署（Docker + 宝塔面板）

以下所有命令在宝塔面板的「终端」中执行。

---

### 第一步：安装 Docker

宝塔面板 → 左侧「Docker」→ 点击「安装」。

安装完成后在终端验证：

```bash
docker --version
docker compose version
```

两条命令都能输出版本号就说明安装成功。

---

### 第二步：配置 SSH 免密登录

在本机配置 SSH 密钥，避免每次部署都输入密码。

```bash
# 1. 检查是否已有密钥
ls ~/.ssh/id_*

# 2. 如果没有，生成一对密钥（一路回车，不用设密码短语）
ssh-keygen -t ed25519

# 3. 把公钥传到服务器（需要输入最后一次服务器密码）
ssh-copy-id root@你的服务器IP
```

之后所有 ssh/rsync/scp 到这台服务器都不再需要密码。

注意：
- 同一个公钥可以放到多台服务器，每台执行一次 `ssh-copy-id` 即可
- 不要重复执行 `ssh-keygen`，会覆盖旧密钥，导致已配置的服务器失效
- 如果已有密钥，跳过第 2 步，直接执行第 3 步

---

### 第三步：拉取代码

```bash
cd /www/wwwroot
git clone https://github.com/你的用户名/Synapse.git synapse
cd synapse/server
```

如果是私有仓库，先配置 SSH key 或使用 token：

```bash
# 用 token 方式（把 YOUR_TOKEN 替换成你的 GitHub Personal Access Token）
git clone https://YOUR_TOKEN@github.com/你的用户名/Synapse.git synapse
```

---

### 第四步：生成 JWT Secret

在服务器上执行以下命令，把输出结果记下来，后面要用。

```bash
cd /www/wwwroot/synapse/server

openssl rand -hex 32
```

---

### 第五步：创建环境变量文件

```bash
cd /www/wwwroot/synapse/server
cp .env.example .env
```

用 vi 编辑（或宝塔面板的文件管理器打开编辑）：

```bash
vi .env
```

vi 基本操作：按 `i` 进入编辑模式，改完后按 `Esc`，输入 `:wq` 回车保存退出。

把文件内容改成下面这样（替换所有中文提示部分）：

```env
# 数据库密码（compose.yml 会读取这个值作为 Postgres 和连接字符串的密码）
POSTGRES_PASSWORD=Abc123456789

# 管理员账号（密码至少 12 位）
ADMIN_EMAIL=你的邮箱@example.com
ADMIN_PASSWORD=设一个至少12位的密码

# JWT 密钥（分别执行一次第四步，为管理员和用户令牌生成不同的 hex 字符）
ADMIN_JWT_SECRET=粘贴第四步生成的那串hex字符
USER_ACCESS_JWT_SECRET=再次生成并粘贴另一串hex字符
USER_ACCESS_TOKEN_MINUTES=15
USER_REFRESH_TOKEN_DAYS=30

# 外部访问地址（用于生成团队邀请、密码重置和 Webhook 公开链接，填写用户访问的站点根地址，不带 /api）
APP_PUBLIC_URL=https://yourdomain.com

# API 在容器内部监听 3001，由容器内 Nginx 统一从 3000 对外暴露
PORT=3001

# 腾讯云 COS 存储（可选；配置后用于云盘文件存储和自动备份）
COS_SECRET_ID=你的 SecretId
COS_SECRET_KEY=你的 SecretKey
COS_BUCKET=已存在的存储桶名称，如 synapse-drive-1250000000
COS_REGION=存储桶地域，如 ap-beijing
```

常见配置错误（启动时会报 "服务端环境变量无效"）：
- `ADMIN_PASSWORD` 少于 12 位
- `ADMIN_JWT_SECRET` 少于 32 位（必须用 `openssl rand -hex 32` 生成的 64 字符）
- `USER_ACCESS_JWT_SECRET` 少于 32 位，或和 `ADMIN_JWT_SECRET` 相同
- `ADMIN_EMAIL` 不是合法邮箱格式
- `APP_PUBLIC_URL` 不是用户可访问的站点根地址，或误填成了 `/api` 地址
- `PORT` 不应和对外 Nginx 端口混用，默认保持 `3001`

---

### 第六步：构建并启动

```bash
cd /www/wwwroot/synapse/server
docker compose --env-file .env up -d --build
```

首次构建大约需要 3-5 分钟。看到类似下面的输出就是成功了：

```
✔ Container server-postgres-1  Healthy
✔ Container server-server-1    Started
```

查看是否正常运行：

```bash
docker compose ps
```

应该看到两个容器状态都是 `Up`：

```
NAME                   STATUS
server-postgres-1      Up (healthy)
server-server-1        Up
```

如果 server 容器状态是 `Restarting` 或 `Exit`，查看日志排查：

```bash
docker compose logs server
```

---

### 第七步：域名解析

在你的域名服务商（阿里云/腾讯云/Cloudflare 等）添加一条 DNS 记录：

- 记录类型：`A`
- 主机记录：`api`（如果你想用 `api.yourdomain.com`）
- 记录值：你的服务器公网 IP

添加后等待 1-5 分钟生效。验证：

```bash
ping api.yourdomain.com
# 应该显示你的服务器 IP
```

---

### 第八步：配置 Nginx 反向代理

1. 打开宝塔面板
2. 左侧点击「网站」
3. 点击「添加站点」
4. 域名填写你的域名（比如 `api.yourdomain.com`）
5. PHP 版本选「纯静态」
6. 点击「提交」

创建完成后：

1. 点击刚创建的站点名称，进入设置
2. 左侧点击「反向代理」
3. 点击「添加反向代理」
4. 代理名称填 `synapse`
5. 目标 URL 填 `http://127.0.0.1:3000`
6. 点击「提交」

---

### 第九步：配置 SSL（HTTPS）

前提：第七步的域名解析已经生效（ping 能通）。

1. 在站点设置中，左侧点击「SSL」
2. 选择「Let's Encrypt」
3. 勾选你的域名
4. 点击「申请」
5. 申请成功后，打开「强制 HTTPS」开关

---

### 第十步：验证

```bash
# 在服务器上测试 API
curl http://127.0.0.1:3000/healthz
```

应该返回 `{"status":"ok"}`。

然后浏览器访问：
- API：`https://api.yourdomain.com/healthz`
- 管理后台：`https://api.yourdomain.com/dashboard`

用 `.env` 中的 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 登录。登录后可创建普通账号注册邀请。

---

## 日常运维

### 查看日志

```bash
cd /www/wwwroot/synapse/server

# 查看容器实时日志（Ctrl+C 退出）
docker compose logs -f server

# 查看数据库日志
docker compose logs -f postgres

# 只看最近 100 行
docker compose logs --tail 100 server
```

服务端文件日志写入仓库部署目录下的 `server/logs/`，并通过 Docker Compose 挂载到容器内 `/app/logs`。重建或替换 `server` 容器不会删除这些文件；管理后台的日志页面读取的也是这个目录。

### 更新代码并重新部署

推荐在本机仓库根目录运行部署脚本：

```bash
cd /Users/liyang/.codex/worktrees/f240/Synapse
bash deploy.sh
```

`deploy.sh` 会先读取线上已应用的 Prisma migration，扫描本次待发布 migration 中的危险 SQL。遇到删表、删列、删行、唯一索引或危险 `NOT NULL` 变更时，默认会把待发布 migration、风险数量、文件行号和 SQL 明细写入日志并继续部署；如果需要让风险扫描恢复为阻断部署，可用 `STRICT_MIGRATION_RISK_SCAN=1 bash deploy.sh`。

部署脚本会把本机 `server/.env` 作为配置源，合并同步到服务器的 `/www/wwwroot/synapse/server/.env`，再用远端 `docker compose --env-file .env config` 校验；普通代码同步仍会排除 `server/.env`，避免密钥进入 git 或 rsync 的删除流程。已有远端配置时，`POSTGRES_PASSWORD`、`POSTGRES_USER`、`POSTGRES_DB`、`DATABASE_URL` 会始终保留远端值，避免覆盖已有 Postgres volume 的真实数据库身份。修改 COS、JWT、公开访问地址等配置后，运行 `bash deploy.sh` 会同步到服务器；如果只想更新远端 COS 存储配置，也可以运行 `bash cos.sh`。生产数据库密码轮换需要先备份，再执行数据库用户密码变更并同步远端 `.env`，不要通过普通 deploy 覆盖本机值。

部署会生成两份完整数据库备份：一份在线备份用于临时数据库预演，一份在停旧服务后生成的最终切换前备份。临时数据库预演会把在线备份恢复到 `synapse_preflight_*` 临时库，并在新镜像里执行 `prisma migrate deploy`；预演失败时不会停旧服务。

真正切换前脚本会先通过 Docker 网络验证 `.env` 中的数据库密码能连接 `postgres:5432`，失败时会在停服前中止。切换时脚本只停止 `server` 容器，不会执行 `docker compose down` 或删除 Postgres volume。新服务启动后会轮询检查 `/healthz`、`/dashboard/` 静态入口、`/dashboard` 到 `/dashboard/` 的重定向，以及 `/webhooks/not-found/test` 公共 Webhook 路由不会被导向管理后台。失败时自动回滚到上一版服务镜像，但不会自动覆盖恢复数据库，避免误删部署窗口里的新写入；脚本会打印失败检查项、HTTP 状态、响应摘要、容器状态、最近 server 日志、最终备份路径和人工恢复命令。

如果是在服务器上手动更新，也必须先备份，再构建启动：

```bash
cd /www/wwwroot/synapse/server
mkdir -p ../backups
MANUAL_IMAGE_TAG=manual-$(date +%Y%m%d_%H%M%S)
docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse > ../backups/synapse-before-manual-deploy_$(date +%Y%m%d_%H%M%S).sql
SYNAPSE_SERVER_IMAGE_TAG=$MANUAL_IMAGE_TAG docker compose --env-file .env build server
docker compose --env-file .env stop server
docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse > ../backups/synapse-final-before-manual-switch_$(date +%Y%m%d_%H%M%S).sql
SYNAPSE_SERVER_IMAGE_TAG=$MANUAL_IMAGE_TAG docker compose --env-file .env up -d --no-build server
```

### 重启服务（不重新构建）

```bash
cd /www/wwwroot/synapse/server
docker compose --env-file .env restart server
```

### 停止服务

```bash
cd /www/wwwroot/synapse/server

# 停止（数据保留）
docker compose down

# 停止并删除数据库数据（谨慎！不可恢复）
docker compose down -v
```

### 数据库备份

`deploy.sh` 的自动备份会保存在 `/www/wwwroot/synapse/backups/`。在线预演备份文件名形如 `synapse-online-before-deploy-20260606_121500.sql`，最终切换前备份文件名形如 `synapse-final-before-switch-20260606_121500.sql`。

也可以手动备份：

```bash
cd /www/wwwroot/synapse/server

mkdir -p ../backups
docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse > ../backups/synapse-manual_$(date +%Y%m%d_%H%M%S).sql

# 查看备份文件
ls -la ../backups/*.sql
```

### 从备份恢复数据库

恢复会覆盖当前数据库内容。执行前请确认目标备份文件正确，并确保当前服务可以短暂停机。

```bash
cd /www/wwwroot/synapse/server

docker compose --env-file .env stop server
docker compose --env-file .env exec -T postgres psql -U synapse -d synapse -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker compose --env-file .env exec -T postgres psql -U synapse -d synapse < ../backups/synapse-final-before-switch-20260606_121500.sql
SYNAPSE_SERVER_IMAGE_TAG=rollback-20260606_121500 docker compose --env-file .env up -d --no-build server
```

### 查看磁盘占用

```bash
# Docker 整体占用
docker system df

# 清理无用的旧镜像（释放空间）
docker image prune -f
```

### 本地与服务器数据库同步

本地开发环境和生产服务器使用相同的 Prisma 迁移体系，但不要把 `--data-only` 当成常规同步方式推生产。需要同步时使用完整 dump/restore，并先确认目标库可以被覆盖。

#### 服务器 → 本地（推荐排查问题时使用）

```bash
# 1. 在服务器导出完整备份
ssh root@你的服务器IP
cd /www/wwwroot/synapse/server
mkdir -p ../backups
docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse > ../backups/synapse-server_$(date +%Y%m%d_%H%M%S).sql
exit

# 2. 拉回本地
scp root@你的服务器IP:/www/wwwroot/synapse/backups/synapse-server_YYYYmmdd_HHMMSS.sql ./synapse-server.sql

# 3. 覆盖本地开发数据库
cd /Users/liyang/.codex/worktrees/f240/Synapse/server
docker compose --env-file .env exec -T postgres psql -U synapse -d synapse -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker compose --env-file .env exec -T postgres psql -U synapse -d synapse < ../synapse-server.sql
```

#### 本地 → 服务器（只在明确要覆盖生产时使用）

```bash
# 1. 在本地导出完整备份
cd /Users/liyang/.codex/worktrees/f240/Synapse/server
docker compose --env-file .env exec -T postgres pg_dump -U synapse synapse > synapse-local.sql

# 2. 上传到服务器备份目录
scp synapse-local.sql root@你的服务器IP:/www/wwwroot/synapse/backups/synapse-local.sql

# 3. SSH 登录服务器，覆盖生产数据库
ssh root@你的服务器IP
cd /www/wwwroot/synapse/server
docker compose --env-file .env stop server
docker compose --env-file .env exec -T postgres psql -U synapse -d synapse -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker compose --env-file .env exec -T postgres psql -U synapse -d synapse < ../backups/synapse-local.sql
docker compose --env-file .env up -d server
```

#### 注意事项

- 完整 dump 包含 schema 和数据，适合恢复到确定状态。
- 覆盖生产前必须保留一份当前生产备份。
- 不要只清空部分表导入生产；当前服务涉及管理员、用户、团队、邀请、会话、权限、审计和备份记录等多张关联表。
- 密码类字段是 bcrypt 哈希，同步后可以直接使用原密码登录。

---

## 常见问题

### 构建失败：内存不足

如果服务器内存小于 2GB，构建时可能 OOM。解决方案：

```bash
# 创建 2GB swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# 永久生效
echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
```

然后重新执行构建命令。

### 端口 3000 被占用

```bash
# 查看谁占用了 3000 端口
lsof -i :3000

# 如果要换对外端口，只修改 compose.yml 中的 ports 映射
# 比如改成 127.0.0.1:3002:3000，同时更新宝塔反向代理的目标 URL
```

### 容器一直重启

如果 `deploy.sh`、`setup.sh` 或 `restart.sh` 的健康检查失败，先看脚本输出的具体失败项和响应摘要；只有需要更多上下文时再查看完整 compose 日志。

```bash
# 查看详细错误日志
docker compose logs server

# 常见原因：
# 1. .env 配置有误（密码不够长、密钥格式不对）
# 2. 数据库连接失败（检查 DATABASE_URL）
# 3. COS_BUCKET / COS_REGION 填错（云盘上传会失败，日志可能出现 NoSuchBucket）
# 4. 端口冲突
```

### 如何进入容器内部调试

```bash
# 进入 server 容器
docker compose exec server sh

# 进入数据库容器
docker compose exec postgres psql -U synapse synapse
```

---

## 目录结构

```
server/               # NestJS API、Prisma、Docker 和 Nginx 配置
├── src/              # API、认证、审计、备份、日志等服务端源码
├── prisma/           # 数据库 Schema 和迁移文件
├── compose.yml       # Docker Compose 编排文件
├── Dockerfile        # Docker 多阶段构建文件
└── .env.example      # 环境变量模板

dashboard/            # React + Vite 管理后台源码，生产构建后由 server 容器的 Nginx 服务到 /dashboard/
```
