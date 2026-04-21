/**
 * 作用：把旧的 `rules/<id>` / `skills/<id>` 目录结构迁移成新的 history-based 存储结构。
 * 它会重写 `meta.json`，生成首条 `history/` 快照，并把旧附件搬到 `attachments-pool/`。
 * 这是维护者手动跑的一次性迁移脚本，不属于日常开发或应用运行流程。
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"

const ZERO_USER_ID = "00000000000000000000000000000000"
const ATTACHMENTS_POOL_DIRECTORY_NAME = "attachments-pool"
const META_FILE_NAME = "meta.json"
const MAIN_FILE_NAME = "main.md"
const HISTORY_DIRECTORY_NAME = "history"

type ContentType = "rule" | "skill"

type LegacyMetaRecord = {
  id?: unknown
  title?: unknown
  description?: unknown
  category?: unknown
  icon?: unknown
  iconBg?: unknown
  author?: unknown
  createdAt?: unknown
}

function formatCompactTimestamp(input: string): string {
  const date = new Date(input)

  if (Number.isNaN(date.getTime())) {
    return `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`
  }

  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return (await readdir(directoryPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return []
    }

    throw error
  }
}

async function ensureJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false
    }

    throw error
  }
}

async function collectLegacyFiles(directoryPath: string): Promise<string[]> {
  const entries = await readDirectoryEntries(directoryPath)
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name === META_FILE_NAME || entry.name === MAIN_FILE_NAME || entry.name === HISTORY_DIRECTORY_NAME) {
      continue
    }

    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectLegacyFiles(entryPath))
      continue
    }

    if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

async function writeAttachmentToPool(repoRootPath: string, sourcePath: string): Promise<{
  originalName: string
  sha256: string
  size: number
}> {
  const fileBuffer = await readFile(sourcePath)
  const sha256 = createHash("sha256").update(fileBuffer).digest("hex")
  const targetPath = path.join(
    repoRootPath,
    ATTACHMENTS_POOL_DIRECTORY_NAME,
    sha256.slice(0, 2),
    sha256.slice(2, 4),
    sha256,
  )

  await mkdir(path.dirname(targetPath), { recursive: true })

  if (!(await pathExists(targetPath))) {
    await writeFile(targetPath, fileBuffer)
  }

  return {
    originalName: path.basename(sourcePath),
    sha256,
    size: fileBuffer.byteLength,
  }
}

async function migrateContentDirectory(
  repoRootPath: string,
  contentType: ContentType,
  contentDirectoryPath: string,
): Promise<boolean> {
  const historyRootPath = path.join(contentDirectoryPath, HISTORY_DIRECTORY_NAME)

  if (await pathExists(historyRootPath)) {
    return false
  }

  const contentId = path.basename(contentDirectoryPath)
  const rawMeta = JSON.parse(
    await readFile(path.join(contentDirectoryPath, META_FILE_NAME), "utf8"),
  ) as LegacyMetaRecord
  const mainContent = await readFile(path.join(contentDirectoryPath, MAIN_FILE_NAME), "utf8")
  const createdAt = normalizeString(rawMeta.createdAt) || new Date().toISOString()
  const displayName = normalizeString(rawMeta.author)
  const historyDirname = `${formatCompactTimestamp(createdAt)}__${ZERO_USER_ID}__legacy`
  const historyDirectoryPath = path.join(historyRootPath, historyDirname)
  const legacyFiles = await collectLegacyFiles(contentDirectoryPath)
  const attachments = []

  for (const legacyFilePath of legacyFiles) {
    attachments.push(await writeAttachmentToPool(repoRootPath, legacyFilePath))
  }

  await mkdir(historyDirectoryPath, { recursive: true })
  await ensureJsonFile(path.join(contentDirectoryPath, META_FILE_NAME), {
    schemaVersion: 1,
    id: normalizeString(rawMeta.id) || contentId,
    type: contentType,
    createdBy: ZERO_USER_ID,
    createdByDisplayName: displayName,
    createdAt,
  })
  await ensureJsonFile(path.join(historyDirectoryPath, "snapshot.json"), {
    schemaVersion: 1,
    title: normalizeString(rawMeta.title) || contentId,
    description: normalizeString(rawMeta.description),
    category: normalizeString(rawMeta.category),
    icon: normalizeString(rawMeta.icon) || "FileText",
    iconBg: normalizeString(rawMeta.iconBg) || "sky",
    modifiedBy: ZERO_USER_ID,
    modifiedByDisplayName: displayName,
    modifiedAt: createdAt,
    deleted: false,
  })
  await rename(
    path.join(contentDirectoryPath, MAIN_FILE_NAME),
    path.join(historyDirectoryPath, MAIN_FILE_NAME),
  )
  await ensureJsonFile(path.join(historyDirectoryPath, "attachments.json"), {
    schemaVersion: 1,
    files: attachments,
  })

  for (const legacyFilePath of legacyFiles) {
    await rm(legacyFilePath, { force: true })
  }

  return true
}

async function main() {
  const repoRootPath = path.resolve(process.argv[2] || process.cwd())
  const migrated: Array<{ contentId: string; contentType: ContentType }> = []

  for (const [directoryName, contentType] of [["rules", "rule"], ["skills", "skill"]] as const) {
    const rootPath = path.join(repoRootPath, directoryName)
    const entries = await readDirectoryEntries(rootPath)

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const contentDirectoryPath = path.join(rootPath, entry.name)
      const didMigrate = await migrateContentDirectory(repoRootPath, contentType, contentDirectoryPath)

      if (didMigrate) {
        migrated.push({
          contentId: entry.name,
          contentType,
        })
      }
    }
  }

  process.stdout.write(`Migrated ${migrated.length} items.\n`)
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
