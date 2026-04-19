import { app, dialog, type BrowserWindow } from "electron"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { CONTENT_TYPE_DEFINITIONS } from "../../src/config/content-types"
import type {
  SynapseConfigBackup,
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "../../src/types/backup"
import { SYNAPSE_THEME_MODE_OPTIONS } from "../../src/types/config"
import type { SynapseContentType } from "../../src/types/content"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { normalizeUserId, userIdentityService } from "./user-identity-service"

const BACKUP_SCHEMA_VERSION = 1 as const
const logger = createMainLogger("service.config-backup")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
  )
}

function formatValidationErrors(errors: string[]): string {
  return `备份文件校验失败：\n${errors.join("\n")}`
}

function readRequiredField(
  value: Record<string, unknown>,
  fieldName: string,
  parentPath: string,
  errors: string[],
): unknown {
  if (!(fieldName in value)) {
    errors.push(`${parentPath}.${fieldName} 缺失。`)
    return undefined
  }

  return value[fieldName]
}

function validateProject(
  rawValue: unknown,
  index: number,
  errors: string[],
): SynapseConfigBackup["config"]["global"]["projects"][number] | null {
  const itemPath = `config.global.projects[${index}]`

  if (!isRecord(rawValue)) {
    errors.push(`${itemPath} 不是对象。`)
    return null
  }

  const id = readRequiredField(rawValue, "id", itemPath, errors)
  const name = readRequiredField(rawValue, "name", itemPath, errors)
  const projectPath = readRequiredField(rawValue, "path", itemPath, errors)

  if (!isNonEmptyString(id)) {
    errors.push(`${itemPath}.id 必须是非空字符串。`)
  }

  if (!isNonEmptyString(name)) {
    errors.push(`${itemPath}.name 必须是非空字符串。`)
  }

  if (!isNonEmptyString(projectPath)) {
    errors.push(`${itemPath}.path 必须是非空字符串。`)
  }

  if (!isNonEmptyString(id) || !isNonEmptyString(name) || !isNonEmptyString(projectPath)) {
    return null
  }

  return {
    id: id.trim(),
    name: name.trim(),
    path: projectPath.trim(),
  }
}

function validateRepository(
  rawValue: unknown,
  index: number,
  errors: string[],
): SynapseConfigBackup["config"]["repositories"][number] | null {
  const itemPath = `config.repositories[${index}]`

  if (!isRecord(rawValue)) {
    errors.push(`${itemPath} 不是对象。`)
    return null
  }

  const uuid = readRequiredField(rawValue, "uuid", itemPath, errors)
  const name = readRequiredField(rawValue, "name", itemPath, errors)
  const localPath = readRequiredField(rawValue, "localPath", itemPath, errors)
  const rawContentDirs = rawValue.contentDirs

  if (!isNonEmptyString(uuid)) {
    errors.push(`${itemPath}.uuid 必须是非空字符串。`)
  }

  if (!isNonEmptyString(name)) {
    errors.push(`${itemPath}.name 必须是非空字符串。`)
  }

  if (!isNonEmptyString(localPath)) {
    errors.push(`${itemPath}.localPath 必须是非空字符串。`)
  }

  if (rawContentDirs !== undefined && !isRecord(rawContentDirs)) {
    errors.push(`${itemPath}.contentDirs 必须是对象。`)
  }

  if (
    !isNonEmptyString(uuid)
    || !isNonEmptyString(name)
    || !isNonEmptyString(localPath)
  ) {
    return null
  }

  const contentDirs = Object.fromEntries(
    CONTENT_TYPE_DEFINITIONS.map((definition) => {
      const fromMap = isRecord(rawContentDirs) ? rawContentDirs[definition.id] : undefined
      const legacyKey = definition.repositoryDir.legacyConfigKey
      const legacyValue = legacyKey ? rawValue[legacyKey] : undefined
      const resolvedValue = isNonEmptyString(fromMap)
        ? fromMap.trim()
        : isNonEmptyString(legacyValue)
          ? legacyValue.trim()
          : definition.repositoryDir.defaultDirectoryName

      if (fromMap !== undefined && !isNonEmptyString(fromMap)) {
        errors.push(`${itemPath}.contentDirs.${definition.id} 必须是非空字符串。`)
      }

      if (legacyValue !== undefined && !isNonEmptyString(legacyValue)) {
        errors.push(`${itemPath}.${legacyKey} 必须是非空字符串。`)
      }

      return [definition.id, resolvedValue]
    }),
  ) as Partial<Record<SynapseContentType, string>>

  return {
    uuid: uuid.trim(),
    name: name.trim(),
    localPath: localPath.trim(),
    contentDirs,
  }
}

function validateConfig(
  rawValue: unknown,
  errors: string[],
): SynapseConfigBackup["config"] | null {
  if (!isRecord(rawValue)) {
    errors.push("config 不是对象。")
    return null
  }

  const activeRepoUuid = readRequiredField(rawValue, "activeRepoUuid", "config", errors)
  const repositories = readRequiredField(rawValue, "repositories", "config", errors)
  const global = readRequiredField(rawValue, "global", "config", errors)

  if (activeRepoUuid !== null && activeRepoUuid !== undefined && !isNonEmptyString(activeRepoUuid)) {
    errors.push("config.activeRepoUuid 必须是字符串或 null。")
  }

  const normalizedRepositories: SynapseConfigBackup["config"]["repositories"] = []

  if (!Array.isArray(repositories)) {
    errors.push("config.repositories 必须是数组。")
  } else {
    repositories.forEach((item, index) => {
      const normalizedRepository = validateRepository(item, index, errors)

      if (normalizedRepository) {
        normalizedRepositories.push(normalizedRepository)
      }
    })
  }

  const repositoryUuidSet = new Set<string>()

  normalizedRepositories.forEach((repository, index) => {
    if (repositoryUuidSet.has(repository.uuid)) {
      errors.push(`config.repositories[${index}].uuid 重复。`)
      return
    }

    repositoryUuidSet.add(repository.uuid)
  })

  if (!isRecord(global)) {
    errors.push("config.global 必须是对象。")
    return null
  }

  const themeMode = readRequiredField(global, "themeMode", "config.global", errors)
  const projects = readRequiredField(global, "projects", "config.global", errors)

  if (
    typeof themeMode !== "string"
    || !SYNAPSE_THEME_MODE_OPTIONS.includes(themeMode as (typeof SYNAPSE_THEME_MODE_OPTIONS)[number])
  ) {
    errors.push(`config.global.themeMode 必须是 ${SYNAPSE_THEME_MODE_OPTIONS.join(" / ")} 之一。`)
  }

  const normalizedProjects: SynapseConfigBackup["config"]["global"]["projects"] = []

  if (!Array.isArray(projects)) {
    errors.push("config.global.projects 必须是数组。")
  } else {
    projects.forEach((item, index) => {
      const normalizedProject = validateProject(item, index, errors)

      if (normalizedProject) {
        normalizedProjects.push(normalizedProject)
      }
    })
  }

  const projectIdSet = new Set<string>()

  normalizedProjects.forEach((project, index) => {
    if (projectIdSet.has(project.id)) {
      errors.push(`config.global.projects[${index}].id 重复。`)
      return
    }

    projectIdSet.add(project.id)
  })

  if (
    activeRepoUuid !== null
    && activeRepoUuid !== undefined
    && isNonEmptyString(activeRepoUuid)
    && !repositoryUuidSet.has(activeRepoUuid.trim())
  ) {
    errors.push("config.activeRepoUuid 在 repositories 里不存在。")
  }

  if (
    activeRepoUuid !== null
    && activeRepoUuid !== undefined
    && !isNonEmptyString(activeRepoUuid)
  ) {
    return null
  }

  if (
    typeof themeMode !== "string"
    || !SYNAPSE_THEME_MODE_OPTIONS.includes(themeMode as (typeof SYNAPSE_THEME_MODE_OPTIONS)[number])
  ) {
    return null
  }

  return {
    activeRepoUuid: activeRepoUuid === null ? null : activeRepoUuid?.trim() ?? null,
    repositories: normalizedRepositories,
    global: {
      themeMode: themeMode as SynapseConfigBackup["config"]["global"]["themeMode"],
      projects: normalizedProjects,
    },
  }
}

function validateIdentity(
  rawValue: unknown,
  errors: string[],
): SynapseConfigBackup["identity"] | null {
  if (!isRecord(rawValue)) {
    errors.push("identity 不是对象。")
    return null
  }

  const schemaVersion = readRequiredField(rawValue, "schemaVersion", "identity", errors)
  const userId = readRequiredField(rawValue, "userId", "identity", errors)
  const generatedAt = readRequiredField(rawValue, "generatedAt", "identity", errors)

  if (schemaVersion !== 2) {
    errors.push("identity.schemaVersion 必须是 2。")
  }

  const normalizedUserId = typeof userId === "string" ? normalizeUserId(userId) : null

  if (!normalizedUserId) {
    errors.push("identity.userId 必须是 32 位十六进制字符串。")
  }

  if (!isIsoDateString(generatedAt)) {
    errors.push("identity.generatedAt 必须是有效时间字符串。")
  }

  if (
    schemaVersion !== 2
    || !normalizedUserId
    || !isIsoDateString(generatedAt)
  ) {
    return null
  }

  return {
    schemaVersion: 2,
    userId: normalizedUserId,
    generatedAt: generatedAt.trim(),
  }
}

function createBackupFileName(): string {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("")
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("")

  return `synapse-config-backup-${date}-${time}.json`
}

function parseBackup(rawValue: unknown): SynapseConfigBackup {
  if (!isRecord(rawValue)) {
    throw new Error("备份文件格式不对。")
  }

  const errors: string[] = []
  const schemaVersion = readRequiredField(rawValue, "schemaVersion", "backup", errors)
  const exportedAt = readRequiredField(rawValue, "exportedAt", "backup", errors)
  const config = readRequiredField(rawValue, "config", "backup", errors)
  const identity = readRequiredField(rawValue, "identity", "backup", errors)

  if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
    errors.push(`backup.schemaVersion 必须是 ${BACKUP_SCHEMA_VERSION}。`)
  }

  if (!isIsoDateString(exportedAt)) {
    errors.push("backup.exportedAt 必须是有效时间字符串。")
  }

  const normalizedConfig = validateConfig(config, errors)
  const normalizedIdentity = validateIdentity(identity, errors)

  if (errors.length > 0 || !normalizedConfig || !normalizedIdentity || !isIsoDateString(exportedAt)) {
    throw new Error(formatValidationErrors(errors))
  }

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: exportedAt.trim(),
    config: normalizedConfig,
    identity: normalizedIdentity,
  }
}

async function writeBackupFile(filePath: string, backup: SynapseConfigBackup): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(backup, null, 2)}\n`, "utf8")
}

class ConfigBackupService {
  async exportBackup(
    ownerWindow: BrowserWindow | null,
  ): Promise<SynapseConfigBackupExportResult | null> {
    const config = await configStore.load()
    const backup: SynapseConfigBackup = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      config: {
        ...config,
        repositories: config.repositories.map((repository) => ({
          uuid: repository.uuid,
          name: repository.name,
          localPath: repository.localPath,
          contentDirs: repository.contentDirs,
        })),
      },
      identity: await userIdentityService.exportIdentity(),
    }
    const defaultPath = path.join(app.getPath("downloads"), createBackupFileName())
    const result = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, {
          defaultPath,
          filters: [{ name: "JSON", extensions: ["json"] }],
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: "JSON", extensions: ["json"] }],
        })

    if (result.canceled || !result.filePath) {
      return null
    }

    await writeBackupFile(result.filePath, backup)

    logger.info("Config backup exported.", {
      filePath: result.filePath,
    })

    return {
      filePath: result.filePath,
    }
  }

  async importBackup(
    ownerWindow: BrowserWindow | null,
  ): Promise<SynapseConfigBackupImportResult | null> {
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          filters: [{ name: "JSON", extensions: ["json"] }],
          properties: ["openFile"],
        })
      : await dialog.showOpenDialog({
          filters: [{ name: "JSON", extensions: ["json"] }],
          properties: ["openFile"],
        })

    if (result.canceled) {
      return null
    }

    const filePath = result.filePaths[0] ?? null

    if (!filePath) {
      return null
    }

    const fileContent = await readFile(filePath, "utf8")
    let parsedValue: unknown

    try {
      parsedValue = JSON.parse(fileContent) as unknown
    } catch {
      throw new Error("备份文件不是有效的 JSON。")
    }

    const backup = parseBackup(parsedValue)

    await configStore.replace(backup.config)
    await userIdentityService.importIdentity(backup.identity)

    logger.info("Config backup imported.", {
      filePath,
    })

    return {
      filePath,
    }
  }
}

export const configBackupService = new ConfigBackupService()
