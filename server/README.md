# Synapse Server

License 管理后端服务，包含 API 和 Admin 管理后台。

## 技术栈

- NestJS 11 + TypeScript
- PostgreSQL 16 + Prisma ORM
- Admin 后台：React 19 + Vite + shadcn/ui

## 本地开发

```bash
# 在项目根目录
pnpm dev
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

### 第二步：拉取代码

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

### 第三步：生成密钥

在服务器上执行以下命令，把输出结果记下来，后面要用。

```bash
cd /www/wwwroot/synapse/server

# 1. 生成 JWT Secret（复制输出的那串字符）
openssl rand -hex 32

# 2. 生成 License 密钥对
openssl genpkey -algorithm Ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem

# 3. 查看私钥内容（复制全部输出，包括 BEGIN/END 行）
cat private.pem

# 4. 查看公钥内容（复制全部输出，包括 BEGIN/END 行）
cat public.pem
```

---

### 第四步：创建环境变量文件

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

# JWT 密钥（至少 32 位，粘贴第三步生成的 hex 字符）
ADMIN_JWT_SECRET=粘贴第三步生成的那串hex字符

# License 密钥对
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n第三步私钥内容，把换行替换成\n\n-----END PRIVATE KEY-----"
LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n第三步公钥内容，把换行替换成\n\n-----END PUBLIC KEY-----"
LICENSE_KEY_ID=prod-key-001
LICENSE_LEASE_DAYS=7
```

关于 LICENSE_PRIVATE_KEY 的格式说明：假设 `cat private.pem` 输出是：

```
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIHxxxxxxxxxxxxxxxxxxxxxx
-----END PRIVATE KEY-----
```

那么 .env 里写成一行：

```
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIHxxxxxxxxxxxxxxxxxxxxxx\n-----END PRIVATE KEY-----"
```

公钥同理。

常见配置错误（启动时会报 "服务端环境变量无效"）：
- `ADMIN_PASSWORD` 少于 12 位
- `ADMIN_JWT_SECRET` 少于 32 位（必须用 `openssl rand -hex 32` 生成的 64 字符）
- `ADMIN_EMAIL` 不是合法邮箱格式
- `LICENSE_PRIVATE_KEY` 或 `LICENSE_PUBLIC_KEY` 格式不对（缺少引号或 `\n`）

---

### 第五步：构建并启动

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

### 第六步：域名解析

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

### 第七步：配置 Nginx 反向代理

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

### 第八步：配置 SSL（HTTPS）

前提：第六步的域名解析已经生效（ping 能通）。

1. 在站点设置中，左侧点击「SSL」
2. 选择「Let's Encrypt」
3. 勾选你的域名
4. 点击「申请」
5. 申请成功后，打开「强制 HTTPS」开关

---

### 第九步：验证

```bash
# 在服务器上测试 API
curl http://127.0.0.1:3000/healthz
```

应该返回 `{"status":"ok"}`。

然后浏览器访问：
- API：`https://api.yourdomain.com/healthz`
- 管理后台：`https://api.yourdomain.com/admin`

用第四步设置的 ADMIN_EMAIL 和 ADMIN_PASSWORD 登录。

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

本地开发环境和生产服务器使用相同的数据库 schema，数据可以双向同步。典型场景：本地创建的激活码同步到生产环境使用，或者从生产环境拉取数据到本地调试。

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

如果只想同步某张表（比如只同步激活码）：

```bash
# 1. 本地只导出指定表（注意表名是 PascalCase 带双引号）
docker compose exec postgres pg_dump -U synapse --data-only -t '"ActivationCode"' synapse > local_codes.sql

# 2. 传到服务器
scp local_codes.sql root@你的服务器IP:/www/wwwroot/synapse/server/

# 3. 服务器上导入
ssh root@你的服务器IP
cd /www/wwwroot/synapse/server
docker compose exec -T postgres psql -U synapse synapse < local_codes.sql
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
docker compose exec -T postgres psql -U synapse synapse -c 'TRUNCATE "ActivationCode", "Account", "License", "Device", "Lease", "ActivationAttempt", "AuditLog" CASCADE;'
docker compose exec -T postgres psql -U synapse synapse < server_data.sql
```

#### 注意事项

- `--data-only` 只导出数据，不导出表结构（两边 schema 通过 prisma migrate 保持一致）
- 导入前确保两边的数据库 schema 版本一致（都跑过最新的 migration）
- 如果遇到主键冲突，加 `TRUNCATE ... CASCADE` 先清空目标表
- 密码类字段（如 admin 密码）是 bcrypt 哈希，同步过去可以直接用
- 密钥对不同不影响数据同步，客户端激活时会从当前服务器重新获取公钥

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
