import { app, dialog } from "electron"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { CONFIG_BACKUP_IMPORT_MAX_BYTES } from "../../config"
import { CONTENT_TYPE_DEFINITIONS } from "../../src/config/content-types"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_KNOWLEDGE_BASE_STORAGE } from "../../src/constants/defaults"
import { DEFAULT_DOCK_APP_IDS, normalizeDockAppIds } from "../../src/modules/apps/dock"
import type {
  SynapseDataRepositoryBackupPayload,
  SynapseConfigBackup,
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "../../src/types/backup"
import type { DataRepository } from "../runtime/data-repo"
import { SYNAPSE_CONTENT_SORT_OPTIONS, SYNAPSE_THEME_MODE_OPTIONS } from "../../src/types/config"
import type {
  SynapseAgentGlobalConfig,
  SynapseConfig,
  SynapseFavorites,
  SynapseKnowledgeBaseStorageConfig,
  SynapseProjectCapabilities,
  SynapseQuickInput,
  SynapseRecentlyViewed,
  SynapseVariable,
} from "../../src/types/config"
import { SYNAPSE_AGENT_PERMISSION_MODES } from "../../src/types/agent"
import { MODEL_TIERS } from "../../src/types/provider-model"
import type { ModelTier } from "../../src/types/provider-model"
import type { SynapseContentType } from "../../src/types/content"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { normalizeUserId, userIdentityService } from "./user-identity-service"

const BACKUP_SCHEMA_VERSION = 1 as const
const logger = createMainLogger("service.config-backup")
let dataRepositoryForBackup: Pick<DataRepository, "exportAll" | "importAll"> | null = null
type LegacyBackupRepositoryConfig = SynapseConfigBackup["config"]["repositories"][number] & {
  variables?: unknown
}
type BackupConfigWithLegacyVariables = Omit<SynapseConfigBackup["config"], "repositories"> & {
  repositories: LegacyBackupRepositoryConfig[]
}
export type ConfigBackupPreparedImport = {
  readonly filePath: string
  readonly identity: SynapseConfigBackup["identity"]
  readonly dataRepository?: SynapseDataRepositoryBackupPayload
  readonly previousConfig: SynapseConfig
  readonly nextConfig: SynapseConfigBackup["config"]
}

function setConfigBackupDataRepository(repository: Pick<DataRepository, "exportAll" | "importAll"> | null): void {
  dataRepositoryForBackup = repository
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isDataRepositoryBackupPayload(value: unknown): value is SynapseDataRepositoryBackupPayload {
  if (!isRecord(value) || value.format !== "synapse-backup-v1" || !isIsoDateString(value.exportedAt)) {
    return false
  }
  if (!Array.isArray(value.namespaces)) return false
  return value.namespaces.every((entry) => {
    if (!isRecord(entry)) return false
    if (!isNonEmptyString(entry.name)) return false
    if (typeof entry.schemaVersion !== "number") return false
    if (typeof entry.encrypted !== "boolean") return false
    if (entry.data === null) return true
    if (!isRecord(entry.data)) return false
    const items = entry.data.items
    return items === undefined || Array.isArray(items)
  })
}

function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
  )
}

function validateKnowledgeBaseStorageConfig(
  rawValue: unknown,
  errors: string[],
): SynapseKnowledgeBaseStorageConfig | null {
  if (rawValue === undefined) {
    return DEFAULT_KNOWLEDGE_BASE_STORAGE
  }

  if (!isRecord(rawValue)) {
    errors.push("config.global.knowledgeBaseStorage 必须是对象。")
    return null
  }

  if (rawValue.mode === "default") {
    return DEFAULT_KNOWLEDGE_BASE_STORAGE
  }

  if (rawValue.mode === "custom" && isNonEmptyString(rawValue.rootPath)) {
    return {
      mode: "custom",
      rootPath: rawValue.rootPath.trim(),
    }
  }

  errors.push("config.global.knowledgeBaseStorage 必须是 default 或包含 rootPath 的 custom。")
  return null
}

function validateDockAppIds(rawValue: unknown, errors: string[]): SynapseConfig["global"]["dockAppIds"] | null {
  if (rawValue === undefined) {
    return [...DEFAULT_DOCK_APP_IDS]
  }

  if (!Array.isArray(rawValue)) {
    errors.push("config.global.dockAppIds 必须是数组。")
    return null
  }

  return normalizeDockAppIds(rawValue)
}

function formatValidationErrors(errors: string[]): string {
  return `备份文件校验失败：\n${errors.join("\n")}`
}

async function readBackupImportFile(filePath: string): Promise<string> {
  const fileStats = await stat(filePath)
  if (fileStats.size > CONFIG_BACKUP_IMPORT_MAX_BYTES) {
    throw new Error(`备份文件超过 ${CONFIG_BACKUP_IMPORT_MAX_BYTES} 字节上限。`)
  }

  const content = await readFile(filePath)
  if (content.byteLength > CONFIG_BACKUP_IMPORT_MAX_BYTES) {
    throw new Error(`备份文件超过 ${CONFIG_BACKUP_IMPORT_MAX_BYTES} 字节上限。`)
  }

  return content.toString("utf8")
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
  const capabilities = validateProjectCapabilities(rawValue.capabilities, `${itemPath}.capabilities`, errors)

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
    ...(capabilities ? { capabilities } : undefined),
  }
}

function validateProjectCapabilities(
  rawValue: unknown,
  itemPath: string,
  errors: string[],
): SynapseProjectCapabilities | undefined {
  if (rawValue === undefined) {
    return undefined
  }

  if (!isRecord(rawValue)) {
    errors.push(`${itemPath} 必须是对象。`)
    return undefined
  }

  if (rawValue.knowledgeBase === undefined) {
    return undefined
  }

  const knowledgeBasePath = `${itemPath}.knowledgeBase`
  const knowledgeBase = rawValue.knowledgeBase
  if (!isRecord(knowledgeBase)) {
    errors.push(`${knowledgeBasePath} 必须是对象。`)
    return undefined
  }

  const templateVersion = knowledgeBase.templateVersion
  const runtimeId = knowledgeBase.runtimeId
  if (knowledgeBase.enabled !== true) {
    errors.push(`${knowledgeBasePath}.enabled 必须是 true。`)
  }
  if (knowledgeBase.schemaVersion !== 1) {
    errors.push(`${knowledgeBasePath}.schemaVersion 必须是 1。`)
  }
  if (!isNonEmptyString(templateVersion)) {
    errors.push(`${knowledgeBasePath}.templateVersion 必须是非空字符串。`)
  }
  if (knowledgeBase.managed !== undefined && knowledgeBase.managed !== true) {
    errors.push(`${knowledgeBasePath}.managed 必须是 true。`)
  }
  if (runtimeId !== undefined && !isNonEmptyString(runtimeId)) {
    errors.push(`${knowledgeBasePath}.runtimeId 必须是非空字符串。`)
  }

  if (
    knowledgeBase.enabled !== true
    || knowledgeBase.schemaVersion !== 1
    || !isNonEmptyString(templateVersion)
    || (knowledgeBase.managed !== undefined && knowledgeBase.managed !== true)
    || (runtimeId !== undefined && !isNonEmptyString(runtimeId))
  ) {
    return undefined
  }

  return {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion: templateVersion.trim(),
      ...(knowledgeBase.managed === true ? { managed: true } : undefined),
      ...(isNonEmptyString(runtimeId) ? { runtimeId: runtimeId.trim() } : undefined),
    },
  }
}

const VARIABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/

function validateVariables(
  rawValue: unknown,
  itemPath: string,
  errors: string[],
): SynapseVariable[] | undefined {
  if (rawValue === undefined) {
    return undefined
  }

  if (!Array.isArray(rawValue)) {
    errors.push(`${itemPath} 必须是数组。`)
    return undefined
  }

  const variables: SynapseVariable[] = []
  rawValue.forEach((item, index) => {
    const variablePath = `${itemPath}[${index}]`
    if (!isRecord(item)) {
      errors.push(`${variablePath} 必须是对象。`)
      return
    }

    const name = item.name
    if (!isNonEmptyString(name) || !VARIABLE_NAME_REGEX.test(name.trim())) {
      errors.push(`${variablePath}.name 必须是字母、数字或下划线组成的非空字符串。`)
      return
    }

    if (typeof item.value !== "string") {
      errors.push(`${variablePath}.value 必须是字符串。`)
      return
    }

    if (item.description !== undefined && typeof item.description !== "string") {
      errors.push(`${variablePath}.description 必须是字符串。`)
      return
    }

    variables.push({
      name: name.trim(),
      value: item.value,
      ...(typeof item.description === "string" && item.description.trim().length > 0
        ? { description: item.description.trim() }
        : undefined),
    })
  })

  return variables.length > 0 ? variables : undefined
}

function variableKey(variable: SynapseVariable): string {
  return variable.name.toLowerCase()
}

function sanitizeVariableNamePart(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
  return sanitized.length > 0 ? sanitized : "Repository"
}

function appendLegacyVariableSource(variable: SynapseVariable, repositoryName: string): SynapseVariable {
  const sourceDescription = `来源：${repositoryName}`
  return {
    ...variable,
    description: variable.description
      ? `${variable.description}；${sourceDescription}`
      : sourceDescription,
  }
}

function uniqueLegacyVariableName(baseName: string, repositoryName: string, usedNames: Set<string>): string {
  const prefix = `${baseName}__${sanitizeVariableNamePart(repositoryName)}`
  let candidate = prefix
  let index = 2

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${prefix}_${index}`
    index += 1
  }

  return candidate
}

function normalizeLegacyRepositoryVariables(rawValue: unknown): SynapseVariable[] {
  const ignoredErrors: string[] = []
  return validateVariables(rawValue, "config.repositories.variables", ignoredErrors) ?? []
}

function mergeBackupVariables(config: BackupConfigWithLegacyVariables): SynapseConfigBackup["config"] {
  const repositories = config.repositories.map(({ variables: _variables, ...repository }) => repository)
  const result = [...config.global.variables]
  const usedNames = new Set(result.map(variableKey))
  const orderedRepositories = [
    ...config.repositories.filter((repository) => repository.uuid === config.activeRepoUuid),
    ...config.repositories.filter((repository) => repository.uuid !== config.activeRepoUuid),
  ]

  for (const repository of orderedRepositories) {
    const legacyVariables = normalizeLegacyRepositoryVariables(repository.variables)

    for (const variable of legacyVariables) {
      const existing = result.find((item) => variableKey(item) === variableKey(variable))
      if (!existing) {
        result.push(variable)
        usedNames.add(variableKey(variable))
        continue
      }

      if (existing.value === variable.value) {
        continue
      }

      const renamed = appendLegacyVariableSource({
        ...variable,
        name: uniqueLegacyVariableName(variable.name, repository.name, usedNames),
      }, repository.name)
      result.push(renamed)
      usedNames.add(variableKey(renamed))
    }
  }

  return {
    ...config,
    repositories,
    global: {
      ...config.global,
      variables: result,
    },
  }
}

function mergeLocalMachineConfig(
  importedConfig: SynapseConfigBackup["config"],
  currentConfig: SynapseConfig,
): SynapseConfigBackup["config"] {
  return {
    ...importedConfig,
    global: {
      ...importedConfig.global,
      knowledgeBaseStorage: currentConfig.global.knowledgeBaseStorage,
      variables: mergeLocalVariableValues(importedConfig.global.variables, currentConfig.global.variables),
    },
  }
}

function mergeLocalVariableValues(
  importedVariables: SynapseVariable[],
  currentVariables: SynapseVariable[],
): SynapseVariable[] {
  const currentByKey = new Map(currentVariables.map((variable) => [variableKey(variable), variable]))

  return importedVariables.map((variable) => {
    const currentVariable = currentByKey.get(variableKey(variable))
    if (variable.value === "" && currentVariable && currentVariable.value !== "") {
      return {
        ...variable,
        value: currentVariable.value,
      }
    }

    return variable
  })
}

function validateRepository(
  rawValue: unknown,
  index: number,
  errors: string[],
): LegacyBackupRepositoryConfig | null {
  const itemPath = `config.repositories[${index}]`

  if (!isRecord(rawValue)) {
    errors.push(`${itemPath} 不是对象。`)
    return null
  }

  const uuid = readRequiredField(rawValue, "uuid", itemPath, errors)
  const name = readRequiredField(rawValue, "name", itemPath, errors)
  const localPath = readRequiredField(rawValue, "localPath", itemPath, errors)
  const rawContentDirs = rawValue.contentDirs
  const rulesDir = rawValue.rulesDir
  const skillsDir = rawValue.skillsDir

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

  if (rulesDir !== undefined && !isNonEmptyString(rulesDir)) {
    errors.push(`${itemPath}.rulesDir 必须是非空字符串。`)
  }

  if (skillsDir !== undefined && !isNonEmptyString(skillsDir)) {
    errors.push(`${itemPath}.skillsDir 必须是非空字符串。`)
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
    ...(isNonEmptyString(rulesDir) ? { rulesDir: rulesDir.trim() } : undefined),
    ...(isNonEmptyString(skillsDir) ? { skillsDir: skillsDir.trim() } : undefined),
    ...(rawValue.variables !== undefined ? { variables: rawValue.variables } : undefined),
  }
}

function validateStringList(rawValue: unknown, itemPath: string, errors: string[]): string[] {
  if (rawValue === undefined) {
    return []
  }

  if (!Array.isArray(rawValue)) {
    errors.push(`${itemPath} 必须是数组。`)
    return []
  }

  const values: string[] = []
  rawValue.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      errors.push(`${itemPath}[${index}] 必须是非空字符串。`)
      return
    }
    values.push(item.trim())
  })
  return values
}

function validateContentLists(
  rawValue: unknown,
  itemPath: string,
  errors: string[],
): SynapseFavorites & SynapseRecentlyViewed {
  if (rawValue === undefined) {
    return { rule: [], skill: [], prompt: [] }
  }

  if (!isRecord(rawValue)) {
    errors.push(`${itemPath} 必须是对象。`)
    return { rule: [], skill: [], prompt: [] }
  }

  return {
    rule: validateStringList(rawValue.rule, `${itemPath}.rule`, errors),
    skill: validateStringList(rawValue.skill, `${itemPath}.skill`, errors),
    prompt: validateStringList(rawValue.prompt, `${itemPath}.prompt`, errors),
  }
}

function validateQuickInputs(rawValue: unknown, errors: string[]): SynapseQuickInput[] {
  if (rawValue === undefined) {
    return []
  }

  if (!Array.isArray(rawValue)) {
    errors.push("config.global.quickInputs 必须是数组。")
    return []
  }

  const seenIds = new Set<string>()
  const quickInputs: SynapseQuickInput[] = []

  rawValue.forEach((item, index) => {
    const itemPath = `config.global.quickInputs[${index}]`
    if (!isRecord(item)) {
      errors.push(`${itemPath} 必须是对象。`)
      return
    }

    const id = item.id
    const content = item.content
    if (!isNonEmptyString(id)) {
      errors.push(`${itemPath}.id 必须是非空字符串。`)
      return
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      errors.push(`${itemPath}.content 必须是非空字符串。`)
      return
    }

    const normalizedId = id.trim()
    if (seenIds.has(normalizedId)) {
      errors.push(`${itemPath}.id 重复。`)
      return
    }

    seenIds.add(normalizedId)
    quickInputs.push({
      id: normalizedId,
      content,
      directSend: typeof item.directSend === "boolean" ? item.directSend : false,
    })
  })

  return quickInputs
}

function validateQuickInputSeededVersion(rawValue: unknown, errors: string[]): string | null {
  if (rawValue === undefined || rawValue === null) {
    return null
  }

  if (typeof rawValue !== "string") {
    errors.push("config.global.defaultQuickInputsSeededVersion 必须是字符串或 null。")
    return null
  }

  const normalized = rawValue.trim()
  return normalized.length > 0 ? normalized : null
}

function validateAgentConfig(
  rawValue: unknown,
  errors: string[],
): SynapseAgentGlobalConfig | null {
  if (rawValue === undefined) {
    return structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG)
  }

  if (!isRecord(rawValue)) {
    errors.push("config.agent 必须是对象。")
    return null
  }

  const rawPermissionMode = rawValue.defaultPermissionMode
  const defaultPermissionMode = rawPermissionMode === undefined && rawValue.defaultBypassPermissions === true
    ? "bypassPermissions"
    : rawPermissionMode === undefined
      ? "default"
      : rawPermissionMode

  if (
    typeof defaultPermissionMode !== "string"
    || !SYNAPSE_AGENT_PERMISSION_MODES.includes(defaultPermissionMode as (typeof SYNAPSE_AGENT_PERMISSION_MODES)[number])
  ) {
    errors.push(`config.agent.defaultPermissionMode 必须是 ${SYNAPSE_AGENT_PERMISSION_MODES.join(" / ")} 之一。`)
    return null
  }
  const normalizedPermissionMode = defaultPermissionMode as SynapseAgentGlobalConfig["defaultPermissionMode"]
  const experimentalSynapseToolRouterEnabled = rawValue.experimentalSynapseToolRouterEnabled === true
  const recentSlashSkills = validateRecentSlashSkills(rawValue.recentSlashSkills, errors)
  if (!recentSlashSkills) return null

  const providerModel = rawValue.defaultProviderModel
  if (providerModel === undefined || providerModel === null) {
    return {
      defaultPermissionMode: normalizedPermissionMode,
      defaultProviderModel: null,
      experimentalSynapseToolRouterEnabled,
      recentSlashSkills,
    }
  }

  if (!isRecord(providerModel)) {
    errors.push("config.agent.defaultProviderModel 必须是对象或 null。")
    return null
  }

  const providerId = providerModel.providerId
  const modelTier = providerModel.modelTier
  if (!isNonEmptyString(providerId)) {
    errors.push("config.agent.defaultProviderModel.providerId 必须是非空字符串。")
  }
  if (typeof modelTier !== "string" || !MODEL_TIERS.includes(modelTier as (typeof MODEL_TIERS)[number])) {
    errors.push(`config.agent.defaultProviderModel.modelTier 必须是 ${MODEL_TIERS.join(" / ")} 之一。`)
  }

  if (!isNonEmptyString(providerId) || typeof modelTier !== "string" || !MODEL_TIERS.includes(modelTier as (typeof MODEL_TIERS)[number])) {
    return null
  }

  return {
    defaultPermissionMode: normalizedPermissionMode,
    defaultProviderModel: {
      providerId: providerId.trim(),
      modelTier: modelTier as ModelTier,
    },
    experimentalSynapseToolRouterEnabled,
    recentSlashSkills,
  }
}

function validateRecentSlashSkills(rawValue: unknown, errors: string[]): string[] | null {
  if (rawValue === undefined) return []
  if (!Array.isArray(rawValue) || !rawValue.every((item) => typeof item === "string")) {
    errors.push("config.agent.recentSlashSkills 必须是字符串数组。")
    return null
  }
  return [...new Set(rawValue
    .map((item) => item.trim().replace(/^\/+/, "").toLowerCase())
    .filter(Boolean))].slice(0, 3)
}

function validateConfig(
  rawValue: unknown,
  errors: string[],
): BackupConfigWithLegacyVariables | null {
  if (!isRecord(rawValue)) {
    errors.push("config 不是对象。")
    return null
  }

  const activeRepoUuid = readRequiredField(rawValue, "activeRepoUuid", "config", errors)
  const repositories = readRequiredField(rawValue, "repositories", "config", errors)
  const global = readRequiredField(rawValue, "global", "config", errors)
  const normalizedAgent = validateAgentConfig(rawValue.agent, errors)

  if (activeRepoUuid !== null && activeRepoUuid !== undefined && !isNonEmptyString(activeRepoUuid)) {
    errors.push("config.activeRepoUuid 必须是字符串或 null。")
  }

  const normalizedRepositories: LegacyBackupRepositoryConfig[] = []

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
  const quickInputs = validateQuickInputs(global.quickInputs, errors)
  const defaultQuickInputsSeededVersion = validateQuickInputSeededVersion(
    global.defaultQuickInputsSeededVersion,
    errors,
  )
  const favorites = validateContentLists(global.favorites, "config.global.favorites", errors)
  const recentlyViewed = validateContentLists(global.recentlyViewed, "config.global.recentlyViewed", errors)
  const contentSortOrder = global.contentSortOrder ?? "modified-desc"
  const variables = validateVariables(global.variables, "config.global.variables", errors) ?? []
  const knowledgeBaseStorage = validateKnowledgeBaseStorageConfig(
    global.knowledgeBaseStorage,
    errors,
  )
  const dockAppIds = validateDockAppIds(global.dockAppIds, errors)

  if (
    typeof themeMode !== "string"
    || !SYNAPSE_THEME_MODE_OPTIONS.includes(themeMode as (typeof SYNAPSE_THEME_MODE_OPTIONS)[number])
  ) {
    errors.push(`config.global.themeMode 必须是 ${SYNAPSE_THEME_MODE_OPTIONS.join(" / ")} 之一。`)
  }

  if (
    typeof contentSortOrder !== "string"
    || !SYNAPSE_CONTENT_SORT_OPTIONS.includes(contentSortOrder as (typeof SYNAPSE_CONTENT_SORT_OPTIONS)[number])
  ) {
    errors.push(`config.global.contentSortOrder 必须是 ${SYNAPSE_CONTENT_SORT_OPTIONS.join(" / ")} 之一。`)
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
    || typeof contentSortOrder !== "string"
    || !SYNAPSE_CONTENT_SORT_OPTIONS.includes(contentSortOrder as (typeof SYNAPSE_CONTENT_SORT_OPTIONS)[number])
    || !normalizedAgent
    || !knowledgeBaseStorage
    || !dockAppIds
  ) {
    return null
  }

  return {
    activeRepoUuid: activeRepoUuid === null ? null : activeRepoUuid?.trim() ?? null,
    repositories: normalizedRepositories,
    global: {
      themeMode: themeMode as SynapseConfigBackup["config"]["global"]["themeMode"],
      projects: normalizedProjects,
      quickInputs,
      defaultQuickInputsSeededVersion,
      favorites,
      recentlyViewed,
      contentSortOrder: contentSortOrder as SynapseConfigBackup["config"]["global"]["contentSortOrder"],
      variables,
      knowledgeBaseStorage,
      dockAppIds,
    },
    agent: normalizedAgent,
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
  const dataRepository = rawValue.dataRepository

  if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
    errors.push(`backup.schemaVersion 必须是 ${BACKUP_SCHEMA_VERSION}。`)
  }

  if (!isIsoDateString(exportedAt)) {
    errors.push("backup.exportedAt 必须是有效时间字符串。")
  }

  const normalizedConfig = validateConfig(config, errors)
  const normalizedIdentity = validateIdentity(identity, errors)
  const normalizedDataRepository = dataRepository === undefined
    ? undefined
    : isDataRepositoryBackupPayload(dataRepository)
      ? prepareTerminalOrdinaryRestore(dataRepository)
      : null
  if (dataRepository !== undefined && normalizedDataRepository === null) {
    errors.push("backup.dataRepository 必须是有效的数据仓库备份。")
  }

  if (errors.length > 0 || !normalizedConfig || !normalizedIdentity || !isIsoDateString(exportedAt)) {
    throw new Error(formatValidationErrors(errors))
  }

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: exportedAt.trim(),
    config: normalizedConfig,
    identity: normalizedIdentity,
    ...(normalizedDataRepository ? { dataRepository: normalizedDataRepository } : undefined),
  }
}

async function writeBackupFile(filePath: string, backup: SynapseConfigBackup): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(backup, null, 2)}\n`, "utf8")
}

async function createConfigBackupPayload(exportedAt = new Date()): Promise<SynapseConfigBackup> {
  const config = await configStore.load()
  const dataRepository = dataRepositoryForBackup
    ? prepareTerminalOrdinaryBackup(await dataRepositoryForBackup.exportAll({
        includeSecrets: false,
        excludeNamespaces: [
          "core.config",
          "agent.events",
          "agent.artifacts",
          "agent.usage",
          "conversations",
          "outbox",
          "telemetry.outbox",
          "audit",
        ],
        emptyNamespaces: [...TERMINAL_BODY_NAMESPACES, "agent.file-checkpoints"],
      }))
    : undefined
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    config: {
      ...config,
      global: {
        ...config.global,
        variables: config.global.variables.map((variable) => ({
          name: variable.name,
          value: "",
          ...(variable.description !== undefined ? { description: variable.description } : undefined),
        })),
      },
      repositories: config.repositories.map((repository) => ({
        uuid: repository.uuid,
        name: repository.name,
        localPath: repository.localPath,
        contentDirs: repository.contentDirs,
        ...(repository.rulesDir !== undefined ? { rulesDir: repository.rulesDir } : undefined),
        ...(repository.skillsDir !== undefined ? { skillsDir: repository.skillsDir } : undefined),
      })),
    },
    identity: await userIdentityService.exportIdentity(),
    ...(dataRepository ? { dataRepository } : undefined),
  }
}

const TERMINAL_BODY_NAMESPACES = new Set([
  "app.terminal.command-bodies",
  "app.terminal.global-launch-bodies",
  "app.terminal.group-launch-bodies",
  "app.terminal.launch-bodies",
  "app.terminal.blocks",
  "app.terminal.delete-intents",
  "app.terminal.idempotency",
])

function prepareTerminalOrdinaryBackup(
  payload: SynapseDataRepositoryBackupPayload,
): SynapseDataRepositoryBackupPayload {
  return {
    ...payload,
    namespaces: payload.namespaces.map((entry) => {
      if (TERMINAL_BODY_NAMESPACES.has(entry.name)) {
        return { ...entry, data: { items: [] } }
      }
      if (entry.name === "app.terminal.commands") {
        return mapBackupItems(entry, (item) => ({ ...item, bodyAvailable: false, bodyRef: undefined }))
      }
      if (entry.name === "app.terminal.groups") {
        return mapBackupItems(entry, (item) => ({ ...item, launchBodyRef: undefined }))
      }
      if (entry.name === "app.terminal.sessions") {
        return mapBackupItems(entry, (item) => ({ ...item, launchBodyRef: undefined }))
      }
      if (entry.name === "app.terminal.operations") {
        return filterBackupItems(entry, (item) => item.status === "completed")
      }
      return entry
    }),
  }
}

function prepareTerminalOrdinaryRestore(
  payload: SynapseDataRepositoryBackupPayload,
): SynapseDataRepositoryBackupPayload {
  const prepared = prepareTerminalOrdinaryBackup(payload)
  return {
    ...prepared,
    namespaces: prepared.namespaces.map((entry) => {
      if (entry.name !== "app.terminal.sessions") return entry
      return mapBackupItems(entry, (item) => {
        const nextOutputSeq = typeof item.nextOutputSeq === "number" ? item.nextOutputSeq : 1
        const lifecycle = item.lifecycle === "running" || item.lifecycle === "stopping" ? "lost" : item.lifecycle
        return {
          ...item,
          lifecycle,
          firstRetainedOutputSeq: nextOutputSeq,
          attention: {
            state: "unknown",
            kind: "unknown",
            reason: "backup_excluded",
            confidence: 0,
            detectedAt: new Date().toISOString(),
            throughOutputSeq: Math.max(0, nextOutputSeq - 1),
            sizeRevision: typeof item.sizeRevision === "number" ? item.sizeRevision : 1,
            detectorId: "backup-restore",
            detectorVersion: "1.0.0",
          },
          ...(lifecycle === "lost" ? {
            endFacts: {
              cause: "restored_runtime_unavailable",
              exitCode: null,
              signal: null,
              endedAt: null,
              endTimeUnknown: true,
            },
          } : {}),
        }
      })
    }),
  }
}

function mapBackupItems(
  entry: SynapseDataRepositoryBackupPayload["namespaces"][number],
  transform: (item: Record<string, unknown>) => Record<string, unknown>,
): SynapseDataRepositoryBackupPayload["namespaces"][number] {
  if (!isRecord(entry.data) || !Array.isArray(entry.data.items)) return entry
  return {
    ...entry,
    data: {
      ...entry.data,
      items: entry.data.items.map((item) => isRecord(item) ? transform(item) : item),
    },
  }
}

function filterBackupItems(
  entry: SynapseDataRepositoryBackupPayload["namespaces"][number],
  predicate: (item: Record<string, unknown>) => boolean,
): SynapseDataRepositoryBackupPayload["namespaces"][number] {
  if (!isRecord(entry.data) || !Array.isArray(entry.data.items)) return entry
  return {
    ...entry,
    data: {
      ...entry.data,
      items: entry.data.items.filter((item) => isRecord(item) && predicate(item)),
    },
  }
}

export interface ConfigBackupContext {
  /** Optional browser window for dialog parenting. If not provided, dialog may not be modal. */
  getParentWindow?: () => Electron.BrowserWindow | null
}

class ConfigBackupService {
  /**
   * Show save dialog and return chosen path, or null if cancelled.
   */
  async selectExportTarget(ctx?: ConfigBackupContext): Promise<string | null> {
    const defaultPath = path.join(app.getPath("downloads"), createBackupFileName())
    const parentWindow = ctx?.getParentWindow?.()
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, {
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

    return result.filePath
  }

  /**
   * Create backup payload and write to the given file path.
   */
  async writeExport(filePath: string): Promise<void> {
    const backup = await createConfigBackupPayload()
    await writeBackupFile(filePath, backup)

    logger.info("Config backup exported.", {
      filePath: redactedFilePathForLog(),
    })
  }

  async exportBackup(
    ctx?: ConfigBackupContext,
  ): Promise<SynapseConfigBackupExportResult | null> {
    const filePath = await this.selectExportTarget(ctx)
    if (!filePath) return null

    await this.writeExport(filePath)

    return {
      filePath,
    }
  }

  /**
   * Show open dialog and return chosen file path, or null if cancelled.
   */
  async selectImportSource(ctx?: ConfigBackupContext): Promise<string | null> {
    const parentWindow = ctx?.getParentWindow?.()
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, {
          properties: ["openFile"],
        })
      : await dialog.showOpenDialog({
          properties: ["openFile"],
        })

    if (result.canceled) {
      return null
    }

    return result.filePaths[0] ?? null
  }

  /**
   * Read and import backup from the given file path.
   * Returns success result with message on success.
   * Returns null if cancelled (unreachable from code path where path is provided).
   */
  async prepareImport(filePath: string): Promise<ConfigBackupPreparedImport> {
    const fileContent = await readBackupImportFile(filePath)
    let parsedValue: unknown

    try {
      parsedValue = JSON.parse(fileContent) as unknown
    } catch {
      throw new Error("备份文件不是有效的 JSON。")
    }

    const backup = parseBackup(parsedValue)

    const previousConfig = await configStore.load()
    const nextConfig = mergeLocalMachineConfig(mergeBackupVariables(backup.config), previousConfig)

    return {
      filePath,
      identity: backup.identity,
      ...(backup.dataRepository ? { dataRepository: backup.dataRepository } : undefined),
      previousConfig,
      nextConfig,
    }
  }

  async commitImport(plan: ConfigBackupPreparedImport): Promise<SynapseConfigBackupImportResult> {
    await configStore.replace(plan.nextConfig)

    if (plan.dataRepository && dataRepositoryForBackup) {
      try {
        await dataRepositoryForBackup.importAll(plan.dataRepository)
      } catch (dataRepositoryError) {
        logger.warn("Data repository import failed, rolling back config.", { filePath: redactedFilePathForLog() })
        try {
          await configStore.replace(plan.previousConfig)
        } catch (rollbackError) {
          logger.error("Config backup import rollback failed.", {
            filePath: redactedFilePathForLog(),
            dataRepositoryErrorName: dataRepositoryError instanceof Error ? dataRepositoryError.name : typeof dataRepositoryError,
            dataRepositoryErrorLength: String(dataRepositoryError).length,
            rollbackErrorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
            rollbackErrorLength: String(rollbackError).length,
          })
          throw new Error("配置备份导入失败，且旧配置恢复也失败。当前配置可能已部分改变，请检查配置后重试。", {
            cause: rollbackError,
          })
        }
        throw dataRepositoryError
      }
    }

    try {
      await userIdentityService.importIdentity(plan.identity)
    } catch (identityError) {
      logger.warn("Identity import failed, rolling back config.", { filePath: redactedFilePathForLog() })
      try {
        await configStore.replace(plan.previousConfig)
      } catch (rollbackError) {
        logger.error("Config backup import rollback failed.", {
          filePath: redactedFilePathForLog(),
          identityErrorName: identityError instanceof Error ? identityError.name : typeof identityError,
          identityErrorLength: String(identityError).length,
          rollbackErrorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
          rollbackErrorLength: String(rollbackError).length,
        })
        throw new Error("配置备份导入失败，且旧配置恢复也失败。当前配置可能已部分改变，请检查配置后重试。", {
          cause: rollbackError,
        })
      }
      throw identityError
    }

    logger.info("Config backup imported.", {
      filePath: redactedFilePathForLog(),
    })

    return {
      filePath: plan.filePath,
    }
  }

  async readImport(filePath: string): Promise<SynapseConfigBackupImportResult> {
    return this.commitImport(await this.prepareImport(filePath))
  }

  async importBackup(
    ctx?: ConfigBackupContext,
  ): Promise<SynapseConfigBackupImportResult | null> {
    const filePath = await this.selectImportSource(ctx)
    if (!filePath) {
      return null
    }

    return this.readImport(filePath)
  }
}

export const configBackupService = new ConfigBackupService()

export { createConfigBackupPayload, setConfigBackupDataRepository }

function redactedFilePathForLog(): string {
  return "[path]"
}
