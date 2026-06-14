# 管理后台轻量灾备备份设计

Date: 2026-06-08
Scope: `server/src/backup/`, `server/src/drive/`, `server/README.md`, `deploy.sh`

## Goal

扩展管理后台“备份管理”的运行期备份，让它从“只备份 PostgreSQL 数据库”升级为“轻量灾备包”。目标是在服务器被入侵、系统盘或数据库丢失后，用户可以使用一份备份包、一台新服务器、源码/镜像和本机保存的 `server/.env` 恢复 Synapse 的服务数据状态。

本设计不把 `.env`、JWT secret、COS Secret、数据库密码或其它部署密钥写入备份包。恢复时使用用户电脑上已有的 `server/.env` 作为配置来源。

## Confirmed Decisions

- 后台备份包不包含明文或加密 `.env`。
- 后台备份包不复制 Drive COS 文件字节。
- Drive 文件内容继续依赖现有 `DRIVE_COS_BUCKET` 中的对象。
- 备份包记录 Drive COS 对象清单，用于恢复后校验数据库中的 Drive 元数据是否能对应到真实对象。
- 备份仍上传到 `BACKUP_COS_BUCKET/backups/`。
- 备份列表、下载、删除入口沿用当前管理后台。
- 保留当前 30 天过期清理策略。

## Non-Goals

- 不做完整离线备份，不把 Drive/COS 文件内容复制到备份桶。
- 不备份云账号、COS bucket 配置、DNS、SSL 证书或服务器 root 权限。
- 不在备份包中保存任何 Secret。
- 不实现一键自动恢复生产环境；恢复仍是命令行流程。
- 不改变 `deploy.sh` 的发布切换备份边界。发布切换备份仍保存在服务器本地 `/www/wwwroot/synapse/backups/`。

## Recovery Coverage

轻量灾备包可以帮助恢复：

- PostgreSQL 中的业务数据，例如用户、团队、邀请、权限、审计、Webhook、Drive 元数据等。
- PostgreSQL globals/角色权限。
- Drive 数据库元数据与 COS 对象的对应关系。
- 备份时刻的应用版本、迁移状态和备份文件校验信息。

轻量灾备包不能单独恢复：

- Drive COS 桶被删除或对象被篡改后的文件内容。
- 用户电脑上的 `server/.env` 丢失后的部署密钥。
- 腾讯云账号、DNS、证书或服务器访问权限。
- 没有源码/镜像时的应用二进制。

## Backup Package Structure

备份文件仍使用单个 tar 归档，文件名保持当前形态：

```text
synapse-backup-2026-06-08T14-23-25-189Z.tar
├── database.sql.gz
├── postgres-globals.sql
├── drive-cos-manifest.json
├── backup-manifest.json
└── restore.md
```

### `database.sql.gz`

使用 `pg_dump` 导出的完整业务数据库，并用 gzip 压缩。恢复时导入目标 PostgreSQL 数据库。

### `postgres-globals.sql`

使用 `pg_dumpall --globals-only --no-role-passwords` 导出的 PostgreSQL 角色和全局权限，不能包含 role password hash。恢复时先按需导入 globals，再导入业务数据库；账号密码或认证材料必须通过独立安全渠道重新配置。

### `drive-cos-manifest.json`

记录 Drive COS 对象清单，但不包含对象字节。建议结构：

```json
{
  "bucket": "synapse-file-user-1252371654",
  "region": "ap-beijing",
  "prefix": "drive/",
  "objects": [
    {
      "key": "drive/cuid...",
      "size": 12345,
      "etag": "\"...\"",
      "lastModified": "2026-06-08T14:23:00.000Z"
    }
  ]
}
```

如果 Drive COS 未配置，manifest 写入：

```json
{
  "storage": "local",
  "included": false,
  "reason": "Drive COS is not configured."
}
```

本设计不改变现有本地 Drive fallback 的部署备份行为。若生产未启用 Drive COS，部署脚本仍可在发布窗口备份 `server/data/drive`；后台轻量灾备包不包含本地 Drive 字节。

### `backup-manifest.json`

记录备份元信息和校验和。建议结构：

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-06-08T14:23:25.189Z",
  "app": {
    "package": "@synapse/server",
    "version": "0.1.0"
  },
  "database": {
    "migrationCount": 25
  },
  "contents": [
    {
      "path": "database.sql.gz",
      "sha256": "...",
      "size": 123456
    }
  ],
  "secretsIncluded": false,
  "driveObjectsIncluded": false
}
```

`backup-manifest.json` 不记录任何 secret value。可记录 bucket/region 这类非密钥配置，方便恢复排查。

### `restore.md`

备份包内自带恢复说明，明确恢复前提：

- 用户需要从本机提供 `server/.env`。
- 用户需要源码或可用 Docker 镜像。
- 用户需要确认 Drive COS bucket 仍存在。
- 恢复数据库会覆盖目标环境数据。

## Data Flow

手动备份和定时备份共用同一条 `BackupService.performBackup()` 流程：

1. 校验 Backup COS 配置完整。
2. 创建临时工作目录。
3. 导出 `database.sql.gz`。
4. 使用 `--no-role-passwords` 导出 `postgres-globals.sql`。
5. 如果 Drive COS 已配置，分页列出 `drive/` 前缀对象并写入 `drive-cos-manifest.json`。
6. 计算备份包内容校验和，写入 `backup-manifest.json`。
7. 写入 `restore.md`。
8. 打包为 tar。
9. 上传到 Backup COS，并等待上传流完成。
10. 清理本地临时文件。
11. 清理 30 天前的 Backup COS 旧备份。

下载和删除沿用当前控制器语义。

## Error Handling

- 数据库导出失败：备份失败，记录结构化日志和审计失败记录。
- PostgreSQL globals 导出失败：备份失败；globals 是恢复完整性的必要部分。
- Drive COS 清单导出失败：备份失败。否则恢复时用户会误以为 Drive 可校验。
- Backup COS 上传失败：备份失败并清理临时文件。
- 旧备份清理失败：不阻塞当前备份，只记录日志和审计。
- 清单为空但 Drive COS 已配置：允许成功，manifest 中 `objects` 为空。

## Security

- 不把 `.env` 放入备份包。
- 不把任何 SecretId、SecretKey、JWT secret、数据库密码写入 `backup-manifest.json` 或 `restore.md`。
- 只记录 `BACKUP_COS_BUCKET`、`BACKUP_COS_REGION`、`DRIVE_COS_BUCKET`、`DRIVE_COS_REGION` 这类非密钥定位信息。
- 日志只记录路径、文件名、状态和脱敏错误。
- 管理后台下载备份仍受 `AdminAuthGuard` 保护。

## Testing

需要补充 focused tests：

- `BackupService` 打包包含 `database.sql.gz`、`postgres-globals.sql`、`drive-cos-manifest.json`、`backup-manifest.json`、`restore.md`。
- `postgres-globals.sql` 导出失败会让备份失败。
- Drive COS 配置完整时会分页生成对象清单。
- Drive COS 清单导出失败会让备份失败。
- manifest 不包含 secret 字段和值。
- 上传仍等待文件流完成，覆盖已修复的临时 tar 提前删除竞态。
- 备份列表、下载、删除保持兼容。

## Rollout

1. 先实现后台轻量灾备包结构，不改变 UI 文案和入口。
2. 部署后手动创建一份备份，下载检查 tar 内文件结构。
3. 在临时数据库中验证 `database.sql.gz` 可恢复。
4. 校验 `drive-cos-manifest.json` 与当前 Drive COS 对象可对应。
5. 更新 `server/README.md` 的后台备份和恢复说明。
