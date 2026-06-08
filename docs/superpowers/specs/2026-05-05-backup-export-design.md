# 数据备份导出设计

## 背景

Docker 重置或 volume 丢失会导致 PostgreSQL 中的激活码、License、设备绑定等核心业务数据全部丢失，同时环境变量中的 RSA 密钥对如果丢失，已签发的 Lease Token 无法验证。需要一套自动+手动的备份机制，将数据安全存储到腾讯云 COS。

## 决策摘要

| 项目 | 决策 |
|------|------|
| 备份方式 | pg_dump 全量数据库快照 |
| 实现方案 | NestJS 内置定时任务（@nestjs/schedule） |
| 触发方式 | 每天凌晨 3 点自动 + 管理后台手动触发 |
| 存储位置 | 腾讯云 COS |
| 保留策略 | 保留 30 天，超期自动清理 |
| 密钥备份 | RSA 密钥对 AES-256-GCM 加密后随数据库备份一起上传 |
| COS 配置 | 纯环境变量，不走前端界面 |
| 恢复方式 | 手动命令行（从 COS 下载 → pg_restore → 解密密钥） |

## 与部署切换备份的边界

本设计描述的是应用运行期的自动/手动导出备份，目标是把业务数据和密钥归档到 COS，供后台管理和长期保留使用。`deploy.sh` 里的备份是另一类切换保护：它在发布窗口内本地保存远端 `.env`、Postgres globals、在线数据库快照、停服后的最终数据库快照，以及未配置 COS 时的本地 Drive fallback 目录。

部署切换备份保存在服务器 `/www/wwwroot/synapse/backups/` 下，用于发布失败排查和人工恢复；它不会上传 COS，也不会在健康检查失败时自动恢复数据库，避免覆盖发布窗口内可能已经产生的新写入。最终切换前数据库备份会先恢复到临时库验证成功后才启动新服务。

## 架构

```
┌─────────────────────────────────────┐
│  NestJS Server                      │
│                                     │
│  BackupService                      │
│  ├── @Cron('0 3 * * *')            │
│  ├── performBackup()                │
│  │   ├── pg_dump → .sql.gz         │
│  │   ├── 密钥对 → AES加密 → .enc   │
│  │   ├── 打包 .tar.gz              │
│  │   ├── 上传 COS                  │
│  │   └── 清理 >30天 远端备份        │
│  │                                  │
│  AdminController                    │
│  ├── POST /admin/api/backup         │
│  └── GET  /admin/api/backup/list    │
└─────────────────────────────────────┘
              │
              ▼
┌──────────────────────────┐
│  腾讯云 COS              │
│  /{bucket}/backups/      │
│    synapse-backup-{ts}.tar.gz │
└──────────────────────────┘
```

## 环境变量

| 变量 | 用途 | 示例 | 必填 |
|------|------|------|------|
| `BACKUP_COS_SECRET_ID` | 备份桶腾讯云 API 密钥 ID | `your-cos-secret-id` | 可选 |
| `BACKUP_COS_SECRET_KEY` | 备份桶腾讯云 API 密钥 Key | `xxxxx` | 可选 |
| `BACKUP_COS_BUCKET` | 备份桶名称 | `synapse-backup-1250000000` | 可选 |
| `BACKUP_COS_REGION` | 备份桶地域 | `ap-guangzhou` | 可选 |
| `BACKUP_ENCRYPT_KEY` | AES-256 密钥（32字节 hex） | `64位hex字符串` | 可选（自动生成） |

Backup COS 相关变量全部留空时，自动备份不启用，管理后台备份功能隐藏。

**后期启用**：在本机 `server/.env` 补上 `BACKUP_COS_*` 变量后运行 `bash deploy.sh` 同步到服务器。BackupService 每次 cron 触发时动态检查环境变量是否完整，完整则执行，缺失则跳过。

## 腾讯云 COS 配置指南

### 1. 创建存储桶

1. 登录 [腾讯云对象存储控制台](https://console.cloud.tencent.com/cos/bucket)
2. 点击「创建存储桶」
3. 填写：
   - 名称：`synapse-backup`（系统会自动追加 APPID，最终形如 `synapse-backup-1250000000`）
   - 地域：选择离服务器最近的区域（如 `ap-guangzhou`）
   - 访问权限：**私有读写**
4. 创建完成后，记录完整的存储桶名称（含 APPID 后缀）和地域

### 2. 获取 API 密钥

1. 进入 [API 密钥管理](https://console.cloud.tencent.com/cam/capi)
2. 推荐使用子账号密钥（更安全）：
   - 进入 [用户列表](https://console.cloud.tencent.com/cam)
   - 创建子用户，勾选「编程访问」
   - 仅授予 `QcloudCOSDataFullControl`（COS 数据读写）权限
   - 创建完成后记录 `SecretId` 和 `SecretKey`
3. 如果用主账号密钥（快速但不推荐生产环境）：
   - 直接在 API 密钥管理页面新建密钥
   - 记录 `SecretId` 和 `SecretKey`

### 3. 设置生命周期规则（可选）

作为双重保障，可在 COS 侧也配置过期清理：

1. 进入存储桶 → 基础配置 → 生命周期
2. 添加规则：
   - 前缀：`backups/`
   - 过期删除：35 天（比应用侧 30 天多留几天余量）

### 4. 填入环境变量

```bash
# server/.env 追加
BACKUP_COS_SECRET_ID=your-cos-secret-id
BACKUP_COS_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BACKUP_COS_BUCKET=synapse-backup-1250000000
BACKUP_COS_REGION=ap-guangzhou
BACKUP_ENCRYPT_KEY=（setup.sh 自动生成，或手动执行 openssl rand -hex 32）
```

### 5. 验证

重启服务后，在管理后台点击「立即备份」，确认备份文件出现在 COS 控制台的 `backups/` 目录下。

## 配置方式

通过 `setup.sh` 初始化脚本交互式收集，写入 `server/.env`：

1. 在管理员信息收集之后，提示输入 Backup COS 配置（可回车跳过）
2. `BACKUP_ENCRYPT_KEY` 自动生成（`openssl rand -hex 32`）
3. 所有备份相关变量追加到同一个 `.env` 文件
4. 部署时 `deploy.sh` 的普通 rsync 仍排除 `.env`，但会把本机 `server/.env` 作为配置源合并同步到服务器并校验 compose 配置；数据库初始化类变量（如 `POSTGRES_PASSWORD`、`DATABASE_URL`）保留远端现值，不通过普通 deploy 覆盖

## 备份流程

### 自动备份（每天 03:00）

1. 执行 `pg_dump -U synapse -d synapse`，输出通过 gzip 压缩为 `database.sql.gz`
2. 读取环境变量 `LICENSE_PRIVATE_KEY` + `LICENSE_PUBLIC_KEY` + `LICENSE_KEY_ID`，序列化为 JSON
3. 用 `BACKUP_ENCRYPT_KEY` 做 AES-256-GCM 加密，输出 `keys.json.enc`（含 iv + authTag + ciphertext）
4. 打包为 `synapse-backup-{ISO时间戳}.tar.gz`
5. 通过 cos-nodejs-sdk-v5 上传到 `{BACKUP_COS_BUCKET}/backups/` 前缀
6. 列出远端备份，删除创建时间超过 30 天的对象
7. 写入审计日志（action: `backup_created` / `backup_failed`）

### 手动触发

- `POST /admin/api/backup` — 调用 `BackupService.performBackup()`
- 响应：`{ filename, size, uploadedAt, status }`

### 备份列表

- `GET /admin/api/backup/list` — 调用 COS listObjects API
- 响应：`{ backups: [{ filename, size, lastModified }] }`

## 备份文件结构

```
synapse-backup-2026-05-05T03-00-00.tar.gz
├── database.sql.gz          # pg_dump 全量压缩
└── keys.json.enc            # AES-256-GCM 加密的密钥对
```

## 恢复流程（手动）

```bash
# 1. 下载备份
coscli cp cos://{bucket}/backups/synapse-backup-{ts}.tar.gz ./

# 2. 解压
tar -xzf synapse-backup-{ts}.tar.gz

# 3. 恢复数据库
gunzip -c database.sql.gz | docker exec -i <postgres-container> psql -U synapse -d synapse

# 4. 解密密钥对
node scripts/decrypt-keys.js keys.json.enc
# 输出 LICENSE_PRIVATE_KEY, LICENSE_PUBLIC_KEY, LICENSE_KEY_ID

# 5. 将密钥配置到环境变量（.env 或 compose.yml）
```

## 管理后台界面

- 侧边栏新增「备份管理」入口
- 页面内容：
  - 备份列表表格（文件名、大小、时间、状态）
  - 「立即备份」按钮
  - 最近一次备份状态指示

## 错误处理

- pg_dump 失败：记录审计日志，不影响应用运行
- COS 上传失败：记录审计日志，本地临时文件清理
- 清理过期备份失败：仅记录日志，不阻塞当前备份流程

## 依赖

- `cos-nodejs-sdk-v5` — 腾讯云 COS Node.js SDK
- `@nestjs/schedule` — 定时任务（已有或新增）
- `tar` (npm) — 打包 tar.gz
- Node.js 内置 `crypto` — AES-256-GCM 加密
- Node.js 内置 `child_process` — 执行 pg_dump

## 辅助脚本

- `scripts/decrypt-keys.js` — 命令行工具，输入 .enc 文件 + BACKUP_ENCRYPT_KEY，输出明文密钥对
