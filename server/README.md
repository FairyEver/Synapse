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

# 外部访问地址（用于生成注册邀请和团队邀请链接）
APP_PUBLIC_URL=https://api.yourdomain.com
```

常见配置错误（启动时会报 "服务端环境变量无效"）：
- `ADMIN_PASSWORD` 少于 12 位
- `ADMIN_JWT_SECRET` 少于 32 位（必须用 `openssl rand -hex 32` 生成的 64 字符）
- `USER_ACCESS_JWT_SECRET` 少于 32 位，或和 `ADMIN_JWT_SECRET` 相同
- `ADMIN_EMAIL` 不是合法邮箱格式
- `APP_PUBLIC_URL` 不是用户可访问的后台地址

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

# 查看 API 实时日志（Ctrl+C 退出）
docker compose logs -f server

# 查看数据库日志
docker compose logs -f postgres

# 只看最近 100 行
docker compose logs --tail 100 server
```

### 更新代码并重新部署

```bash
cd /www/wwwroot/synapse
git pull
cd server
docker compose --env-file .env up -d --build
```

数据库迁移会在启动时自动执行。

### 重启服务（不重新构建）

```bash
cd /www/wwwroot/synapse/server
docker compose restart server
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

```bash
cd /www/wwwroot/synapse/server

# 备份到当前目录
docker compose exec postgres pg_dump -U synapse synapse > backup_$(date +%Y%m%d).sql

# 查看备份文件
ls -la backup_*.sql
```

### 从备份恢复数据库

```bash
cd /www/wwwroot/synapse/server

# 恢复（把文件名换成你的备份文件）
docker compose exec -T postgres psql -U synapse synapse < backup_20260505.sql
```

### 查看磁盘占用

```bash
# Docker 整体占用
docker system df

# 清理无用的旧镜像（释放空间）
docker image prune -f
```

### 本地与服务器数据库同步

本地开发环境和生产服务器使用相同的数据库 schema，数据可以双向同步。

#### 本地 → 服务器（把本地数据推到生产）

```bash
# 1. 在本地电脑导出数据库（本地 Postgres 跑在 Docker 里）
cd /Users/liyang/Documents/code/github/Synapse/server
docker compose exec postgres pg_dump -U synapse --data-only synapse > local_data.sql

# 2. 把文件传到服务器
scp local_data.sql root@你的服务器IP:/www/wwwroot/synapse/server/

# 3. SSH 登录服务器，导入数据
ssh root@你的服务器IP
cd /www/wwwroot/synapse/server
docker compose exec -T postgres psql -U synapse synapse < local_data.sql
```

#### 服务器 → 本地（把生产数据拉到本地）

```bash
# 1. 从服务器导出
ssh root@你的服务器IP
cd /www/wwwroot/synapse/server
docker compose exec postgres pg_dump -U synapse --data-only synapse > server_data.sql
exit

# 2. 把文件拉到本地
scp root@你的服务器IP:/www/wwwroot/synapse/server/server_data.sql ./

# 3. 在本地导入（先清空本地数据再导入，避免主键冲突）
cd /Users/liyang/Documents/code/github/Synapse/server
docker compose exec -T postgres psql -U synapse synapse -c 'TRUNCATE "AuditLog", "AdminUser" CASCADE;'
docker compose exec -T postgres psql -U synapse synapse < server_data.sql
```

#### 注意事项

- `--data-only` 只导出数据，不导出表结构（两边 schema 通过 prisma migrate 保持一致）
- 导入前确保两边的数据库 schema 版本一致（都跑过最新的 migration）
- 如果遇到主键冲突，加 `TRUNCATE ... CASCADE` 先清空目标表
- 密码类字段（如 admin 密码）是 bcrypt 哈希，同步过去可以直接用

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

# 如果要换端口，修改 .env 中的 PORT 和 compose.yml 中的 ports 映射
# 比如改成 3001，同时更新宝塔反向代理的目标 URL
```

### 容器一直重启

```bash
# 查看详细错误日志
docker compose logs server

# 常见原因：
# 1. .env 配置有误（密码不够长、密钥格式不对）
# 2. 数据库连接失败（检查 DATABASE_URL）
# 3. 端口冲突
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
server/
├── src/              # NestJS API 源码
├── prisma/           # 数据库 Schema 和迁移文件
├── admin/            # Admin 管理后台前端源码
├── compose.yml       # Docker Compose 编排文件
├── Dockerfile        # Docker 多阶段构建文件
└── .env.example      # 环境变量模板
```
