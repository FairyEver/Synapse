import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"

export interface BackupContentManifestItem {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface BackupPackageManifestInput {
  readonly createdAt: string
  readonly appVersion: string
  readonly migrationCount: number
  readonly backupBucket: string
  readonly backupRegion: string
  readonly driveBucket?: string
  readonly driveRegion?: string
  readonly contents: BackupContentManifestItem[]
}

export interface BackupPackageManifest {
  readonly schemaVersion: 1
  readonly createdAt: string
  readonly app: {
    readonly package: "@synapse/server"
    readonly version: string
  }
  readonly database: {
    readonly migrationCount: number
  }
  readonly storage: {
    readonly backup: {
      readonly bucket: string
      readonly region: string
      readonly prefix: "backups/"
    }
    readonly drive?: {
      readonly bucket: string
      readonly region: string
      readonly prefix: "drive/"
    }
  }
  readonly contents: BackupContentManifestItem[]
  readonly secretsIncluded: false
  readonly driveObjectsIncluded: false
}

export interface RestoreMarkdownInput {
  readonly createdAt: string
  readonly filename: string
}

const secretLikePattern = /(?:secret|token|password|authorization|bearer|api[_-]?key)[\w-]*\s*[:=]/iu

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export function createBackupManifest(input: BackupPackageManifestInput): BackupPackageManifest {
  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    app: {
      package: "@synapse/server",
      version: input.appVersion,
    },
    database: {
      migrationCount: input.migrationCount,
    },
    storage: {
      backup: {
        bucket: input.backupBucket,
        region: input.backupRegion,
        prefix: "backups/",
      },
      ...(input.driveBucket && input.driveRegion
        ? {
            drive: {
              bucket: input.driveBucket,
              region: input.driveRegion,
              prefix: "drive/" as const,
            },
          }
        : {}),
    },
    contents: input.contents,
    secretsIncluded: false,
    driveObjectsIncluded: false,
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return hash.digest("hex")
}

export async function contentManifestItem(baseDir: string, relativePath: string): Promise<BackupContentManifestItem> {
  const filePath = path.join(baseDir, relativePath)
  const info = await stat(filePath)
  return {
    path: relativePath,
    sha256: await sha256File(filePath),
    size: info.size,
  }
}

export function createRestoreMarkdown(input: RestoreMarkdownInput): string {
  return [
    "# Synapse 轻量灾备恢复说明",
    "",
    `备份文件：${input.filename}`,
    `创建时间：${input.createdAt}`,
    "",
    "## 恢复前提",
    "",
    "- 使用你电脑上保存的 `server/.env.server` 作为生产配置来源。",
    "- 确认 Drive COS bucket 和对象仍存在。",
    "- 准备一台新服务器、当前源码或可用 Docker 镜像。",
    "- 恢复数据库会覆盖目标环境数据。",
    "",
    "## 文件说明",
    "",
    "- `database.sql.gz`：业务数据库 dump，不包含问题反馈记录。",
    "- `postgres-globals.sql`：PostgreSQL 角色和全局权限。",
    "- `drive-cos-manifest.json`：Drive COS 对象清单，不包含文件内容。",
    "- `backup-manifest.json`：备份元信息和校验和。",
    "",
    "## 恢复步骤",
    "",
    "1. 解压备份包。",
    "2. 把本机 `server/.env.server` 放到新服务器的 `server/.env`。",
    "3. 启动 PostgreSQL。",
    "4. 按需导入 `postgres-globals.sql`。",
    "5. 解压并导入 `database.sql.gz`。",
    "6. 启动 Synapse server。",
    "7. 对照 `drive-cos-manifest.json` 抽查 Drive COS 对象是否仍可访问。",
    "",
  ].join("\n")
}

export function scanForSecretLikeText(value: string): boolean {
  return secretLikePattern.test(value)
}
