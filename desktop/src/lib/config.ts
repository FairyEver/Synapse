import {
  DEFAULT_AGENT_GLOBAL_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_CONTENT_SORT_ORDER,
  DEFAULT_FAVORITES,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_QUICK_INPUTS,
  DEFAULT_RECENTLY_VIEWED,
  DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
  DEFAULT_THEME_MODE,
} from "../constants/defaults"
import {
  CONTENT_TYPE_DEFINITIONS,
  getContentTypeDefinition,
} from "../config/content-types"
import { SYNAPSE_CONTENT_SORT_OPTIONS, SYNAPSE_THEME_MODE_OPTIONS } from "../types/config"
import { SYNAPSE_AGENT_PERMISSION_MODES } from "../types/agent"
import { MODEL_TIERS } from "../types/provider-model"
import { normalizeDockAppIds } from "../modules/apps/dock"
import type { ModelTier } from "../types/provider-model"
import type { SynapseContentType } from "../types/content"
import type {
  SynapseAgentGlobalConfig,
  SynapseConfig,
  SynapseConfigPatch,
  SynapseContentSortOrder,
  SynapseFavorites,
  SynapseGlobalConfig,
  SynapseKnowledgeBaseStorageConfig,
  SynapseProjectConfig,
  SynapseQuickInput,
  SynapseRecentlyViewed,
  SynapseRepositoryConfig,
  SynapseThemeMode,
  SynapseVariable,
} from "../types/config"
import type { SynapseAgentPermissionMode } from "../types/agent"
import { SYNAPSE_APP_VERSION } from "./app-version"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isDefined<T>(value: T | null): value is T {
  return value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isSynapseThemeMode(value: unknown): value is SynapseThemeMode {
  return typeof value === "string" && SYNAPSE_THEME_MODE_OPTIONS.includes(value as SynapseThemeMode)
}

function isSynapseContentSortOrder(value: unknown): value is SynapseContentSortOrder {
  return typeof value === "string" && SYNAPSE_CONTENT_SORT_OPTIONS.includes(value as SynapseContentSortOrder)
}

function isSynapseAgentPermissionMode(value: unknown): value is SynapseAgentPermissionMode {
  return typeof value === "string"
    && SYNAPSE_AGENT_PERMISSION_MODES.includes(value as SynapseAgentPermissionMode)
}

function asTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

function hasContentDirsFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  return Object.values(value).some((directoryName) => typeof directoryName !== "string")
}

function normalizeThemeMode(value: unknown, fallback: SynapseThemeMode): SynapseThemeMode {
  return isSynapseThemeMode(value) ? value : fallback
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seenKeys = new Set<string>()

  return items.filter((item) => {
    const key = getKey(item)

    if (seenKeys.has(key)) {
      return false
    }

    seenKeys.add(key)

    return true
  })
}

function getPathDisplayName(localPath: string): string {
  const normalizedPath = localPath.replace(/[\\/]+$/, "")
  const segments = normalizedPath.split(/[\\/]/).filter((segment) => segment.length > 0)

  return segments.at(-1) ?? localPath
}

function hasProjectConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "id") && typeof value.id !== "string") {
    return true
  }

  if (hasOwnKey(value, "name") && typeof value.name !== "string") {
    return true
  }

  if (hasOwnKey(value, "path") && typeof value.path !== "string") {
    return true
  }

  return false
}

function normalizeKnowledgeBaseCapability(value: unknown): SynapseProjectConfig["capabilities"] {
  if (!isRecord(value)) {
    return undefined
  }

  const rawKnowledgeBase = value.knowledgeBase
  if (!isRecord(rawKnowledgeBase)) {
    return undefined
  }

  const templateVersion = asTrimmedString(rawKnowledgeBase.templateVersion)
  if (
    rawKnowledgeBase.enabled !== true
    || rawKnowledgeBase.schemaVersion !== 1
    || !templateVersion
  ) {
    return undefined
  }

  const runtimeId = asTrimmedString(rawKnowledgeBase.runtimeId)
  if (rawKnowledgeBase.managed !== true || !runtimeId) {
    return undefined
  }

  return {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion,
      managed: true,
      runtimeId,
    },
  }
}

function hasRepositoryConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "uuid") && typeof value.uuid !== "string") {
    return true
  }

  if (hasOwnKey(value, "name") && typeof value.name !== "string") {
    return true
  }

  if (hasOwnKey(value, "localPath") && typeof value.localPath !== "string") {
    return true
  }

  if (hasOwnKey(value, "rulesDir") && typeof value.rulesDir !== "string") {
    return true
  }

  if (hasOwnKey(value, "skillsDir") && typeof value.skillsDir !== "string") {
    return true
  }

  if (hasOwnKey(value, "contentDirs") && hasContentDirsFormatError(value.contentDirs)) {
    return true
  }

  return false
}

function hasFavoritesFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "rule") && !Array.isArray(value.rule)) {
    return true
  }

  if (hasOwnKey(value, "skill") && !Array.isArray(value.skill)) {
    return true
  }

  if (hasOwnKey(value, "prompt") && !Array.isArray(value.prompt)) {
    return true
  }

  return false
}

function hasGlobalConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "themeMode") && typeof value.themeMode !== "string") {
    return true
  }

  if (hasOwnKey(value, "favorites") && hasFavoritesFormatError(value.favorites)) {
    return true
  }

  if (hasOwnKey(value, "quickInputs") && !Array.isArray(value.quickInputs)) {
    return true
  }

  if (hasOwnKey(value, "knowledgeBaseStorage") && !isRecord(value.knowledgeBaseStorage)) {
    return true
  }

  if (hasOwnKey(value, "dockAppIds") && !Array.isArray(value.dockAppIds)) {
    return true
  }

  if (!hasOwnKey(value, "projects")) {
    return false
  }

  if (!Array.isArray(value.projects)) {
    return true
  }

  return value.projects.some(hasProjectConfigFormatError)
}

export function hasRecoverableSynapseConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (
    hasOwnKey(value, "activeRepoUuid")
    && value.activeRepoUuid !== null
    && typeof value.activeRepoUuid !== "string"
  ) {
    return true
  }

  if (hasOwnKey(value, "repositories")) {
    if (!Array.isArray(value.repositories)) {
      return true
    }

    if (value.repositories.some(hasRepositoryConfigFormatError)) {
      return true
    }
  }

  if (hasOwnKey(value, "global") && hasGlobalConfigFormatError(value.global)) {
    return true
  }

  return false
}

function normalizeProjectConfig(value: unknown): SynapseProjectConfig | null {
  if (!isRecord(value)) {
    return null
  }

  const id = asTrimmedString(value.id)
  const name = asTrimmedString(value.name)
  const projectPath = asTrimmedString(value.path)

  if (!id || !name || !projectPath) {
    return null
  }

  const capabilities = normalizeKnowledgeBaseCapability(value.capabilities)

  return {
    id,
    name,
    path: projectPath,
    ...(capabilities ? { capabilities } : undefined),
  }
}

const VARIABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/

function normalizeVariable(value: unknown): SynapseVariable | null {
  if (!isRecord(value)) {
    return null
  }

  const name = asTrimmedString(value.name)

  if (!name || !VARIABLE_NAME_REGEX.test(name)) {
    return null
  }

  const variableValue = typeof value.value === "string" ? value.value : ""

  return {
    name,
    value: variableValue,
    ...(typeof value.description === "string" && value.description.trim().length > 0
      ? { description: value.description.trim() }
      : undefined),
  }
}

function normalizeVariables(value: unknown): SynapseVariable[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const variables = dedupeByKey(
    value.map(normalizeVariable).filter(isDefined),
    (v) => v.name.toLowerCase(),
  )

  return variables.length > 0 ? variables : undefined
}

function normalizeVariableList(value: unknown): SynapseVariable[] {
  return normalizeVariables(value) ?? []
}

function normalizeRepositoryConfig(value: unknown): SynapseRepositoryConfig | null {
  if (!isRecord(value)) {
    return null
  }

  const uuid = asTrimmedString(value.uuid)
  const localPath = asTrimmedString(value.localPath)
  const name = asTrimmedString(value.name, getPathDisplayName(localPath))

  if (!uuid || !name || !localPath) {
    return null
  }

  return {
    uuid,
    name,
    localPath,
    contentDirs: resolveContentDirs(value),
  }
}

function legacyRepositoryVariableEntries(
  rawRepositories: unknown,
  repositories: SynapseRepositoryConfig[],
  activeRepoUuid: string | null,
): Array<{ repository: SynapseRepositoryConfig; variables: SynapseVariable[] }> {
  if (!Array.isArray(rawRepositories)) {
    return []
  }

  const rawByUuid = new Map<string, Record<string, unknown>>()
  for (const rawRepository of rawRepositories) {
    if (!isRecord(rawRepository)) continue
    const uuid = asTrimmedString(rawRepository.uuid)
    if (!uuid || rawByUuid.has(uuid)) continue
    rawByUuid.set(uuid, rawRepository)
  }

  const orderedRepositories = [
    ...repositories.filter((repository) => repository.uuid === activeRepoUuid),
    ...repositories.filter((repository) => repository.uuid !== activeRepoUuid),
  ]

  return orderedRepositories.flatMap((repository) => {
    const rawRepository = rawByUuid.get(repository.uuid)
    const variables = normalizeVariableList(rawRepository?.variables)
    return variables.length > 0 ? [{ repository, variables }] : []
  })
}

function variableKey(variable: SynapseVariable): string {
  return variable.name.toLowerCase()
}

function sameVariableValue(existing: SynapseVariable, next: SynapseVariable): boolean {
  return existing.value === next.value
}

function sanitizeVariableNamePart(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
  return sanitized.length > 0 ? sanitized : "Repository"
}

function appendLegacySourceDescription(variable: SynapseVariable, repositoryName: string): SynapseVariable {
  const sourceDescription = `来源：${repositoryName}`
  return {
    ...variable,
    description: variable.description
      ? `${variable.description}；${sourceDescription}`
      : sourceDescription,
  }
}

function uniqueLegacyVariableName(
  baseName: string,
  repositoryName: string,
  usedNames: Set<string>,
): string {
  const prefix = `${baseName}__${sanitizeVariableNamePart(repositoryName)}`
  let candidate = prefix
  let index = 2

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${prefix}_${index}`
    index += 1
  }

  return candidate
}

function mergeGlobalAndLegacyVariables(
  globalVariables: SynapseVariable[],
  legacyEntries: Array<{ repository: SynapseRepositoryConfig; variables: SynapseVariable[] }>,
): SynapseVariable[] {
  const result = [...globalVariables]
  const usedNames = new Set(result.map((variable) => variableKey(variable)))

  for (const entry of legacyEntries) {
    for (const variable of entry.variables) {
      const existing = result.find((item) => variableKey(item) === variableKey(variable))
      if (!existing) {
        result.push(variable)
        usedNames.add(variableKey(variable))
        continue
      }

      if (sameVariableValue(existing, variable)) {
        continue
      }

      const renamed = appendLegacySourceDescription({
        ...variable,
        name: uniqueLegacyVariableName(variable.name, entry.repository.name, usedNames),
      }, entry.repository.name)
      result.push(renamed)
      usedNames.add(variableKey(renamed))
    }
  }

  return result
}

function resolveContentDirs(
  value: Record<string, unknown>,
): Record<SynapseContentType, string> {
  const directories = CONTENT_TYPE_DEFINITIONS.map((definition) => {
    const contentDirs = isRecord(value.contentDirs) ? value.contentDirs : null
    const fromMap = contentDirs?.[definition.id]

    if (typeof fromMap === "string" && fromMap.trim().length > 0) {
      return [definition.id, fromMap.trim()] as const
    }

    if (definition.repositoryDir.legacyConfigKey) {
      const legacyValue = value[definition.repositoryDir.legacyConfigKey]

      if (typeof legacyValue === "string" && legacyValue.trim().length > 0) {
        return [definition.id, legacyValue.trim()] as const
      }
    }

    return [definition.id, DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[definition.id]] as const
  })

  return Object.fromEntries(directories) as Record<SynapseContentType, string>
}

function normalizeProjects(value: unknown): SynapseProjectConfig[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG.projects)
  }

  return dedupeByKey(
    value.map(normalizeProjectConfig).filter(isDefined),
    (project) => project.id,
  )
}

function normalizeQuickInput(value: unknown): SynapseQuickInput | null {
  if (!isRecord(value)) {
    return null
  }

  const id = asTrimmedString(value.id)

  if (!id || typeof value.content !== "string" || value.content.trim().length === 0) {
    return null
  }

  return {
    id,
    content: value.content,
    directSend: typeof value.directSend === "boolean" ? value.directSend : false,
  }
}

function normalizeQuickInputs(value: unknown): SynapseQuickInput[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_QUICK_INPUTS)
  }

  return dedupeByKey(
    value.map(normalizeQuickInput).filter(isDefined),
    (quickInput) => quickInput.id,
  )
}

function normalizeQuickInputSeededVersion(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function applyDefaultQuickInputSeed(
  quickInputs: SynapseQuickInput[],
  seededVersion: string | null,
): { quickInputs: SynapseQuickInput[]; seededVersion: string } {
  if (seededVersion === SYNAPSE_APP_VERSION) {
    return {
      quickInputs,
      seededVersion: SYNAPSE_APP_VERSION,
    }
  }

  return {
    quickInputs: quickInputs.length === 0 ? structuredClone(DEFAULT_QUICK_INPUTS) : quickInputs,
    seededVersion: SYNAPSE_APP_VERSION,
  }
}

function normalizeRepositories(value: unknown): SynapseRepositoryConfig[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_CONFIG.repositories)
  }

  return dedupeByKey(
    value.map(normalizeRepositoryConfig).filter(isDefined),
    (repository) => repository.uuid,
  )
}

function normalizeFavorites(value: unknown): SynapseFavorites {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_FAVORITES)
  }

  const ruleIds = Array.isArray(value.rule) ? value.rule.filter((id): id is string => typeof id === "string") : []
  const skillIds = Array.isArray(value.skill) ? value.skill.filter((id): id is string => typeof id === "string") : []
  const promptIds = Array.isArray(value.prompt) ? value.prompt.filter((id): id is string => typeof id === "string") : []

  return {
    rule: ruleIds,
    skill: skillIds,
    prompt: promptIds,
  }
}

function normalizeRecentlyViewed(value: unknown): SynapseRecentlyViewed {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_RECENTLY_VIEWED)
  }

  const ruleIds = Array.isArray(value.rule) ? value.rule.filter((id): id is string => typeof id === "string") : []
  const skillIds = Array.isArray(value.skill) ? value.skill.filter((id): id is string => typeof id === "string") : []
  const promptIds = Array.isArray(value.prompt) ? value.prompt.filter((id): id is string => typeof id === "string") : []

  return {
    rule: ruleIds,
    skill: skillIds,
    prompt: promptIds,
  }
}

function normalizeKnowledgeBaseStorage(value: unknown): SynapseKnowledgeBaseStorageConfig {
  if (!isRecord(value)) {
    return DEFAULT_GLOBAL_CONFIG.knowledgeBaseStorage
  }

  if (value.mode === "custom") {
    const rootPath = asTrimmedString(value.rootPath)
    return rootPath ? { mode: "custom", rootPath } : DEFAULT_GLOBAL_CONFIG.knowledgeBaseStorage
  }

  return DEFAULT_GLOBAL_CONFIG.knowledgeBaseStorage
}

function normalizeGlobalConfig(value: unknown): SynapseGlobalConfig {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG)
  }

  const seeded = applyDefaultQuickInputSeed(
    normalizeQuickInputs(value.quickInputs),
    normalizeQuickInputSeededVersion(value.defaultQuickInputsSeededVersion),
  )

  return {
    themeMode: normalizeThemeMode(value.themeMode, DEFAULT_THEME_MODE),
    projects: normalizeProjects(value.projects),
    quickInputs: seeded.quickInputs,
    defaultQuickInputsSeededVersion: seeded.seededVersion,
    favorites: normalizeFavorites(value.favorites),
    recentlyViewed: normalizeRecentlyViewed(value.recentlyViewed),
    contentSortOrder: isSynapseContentSortOrder(value.contentSortOrder)
      ? value.contentSortOrder
      : DEFAULT_CONTENT_SORT_ORDER,
    variables: normalizeVariableList(value.variables),
    knowledgeBaseStorage: normalizeKnowledgeBaseStorage(value.knowledgeBaseStorage),
    dockAppIds: normalizeDockAppIds(Array.isArray(value.dockAppIds) ? value.dockAppIds : undefined),
  }
}

function normalizeAgentGlobalConfig(value: unknown): SynapseAgentGlobalConfig {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG)
  }

  const defaultPermissionMode = isSynapseAgentPermissionMode(value.defaultPermissionMode)
    ? value.defaultPermissionMode
    : value.defaultBypassPermissions === true
      ? "bypassPermissions"
      : DEFAULT_AGENT_GLOBAL_CONFIG.defaultPermissionMode

  const defaultProviderModel = isRecord(value.defaultProviderModel)
    && isNonEmptyString(value.defaultProviderModel.providerId)
    && typeof value.defaultProviderModel.modelTier === "string"
    && (MODEL_TIERS as readonly string[]).includes(value.defaultProviderModel.modelTier)
    ? {
        providerId: value.defaultProviderModel.providerId.trim(),
        modelTier: value.defaultProviderModel.modelTier as ModelTier,
      }
    : null

  return {
    defaultPermissionMode,
    defaultProviderModel,
  }
}

export function createDefaultConfig(): SynapseConfig {
  return structuredClone(DEFAULT_CONFIG)
}

export function sanitizeSynapseConfig(value: unknown): SynapseConfig {
  const fallbackConfig = createDefaultConfig()

  if (!isRecord(value)) {
    return fallbackConfig
  }

  const repositories = normalizeRepositories(value.repositories)
  const requestedActiveRepoUuid =
    value.activeRepoUuid === null
      ? null
      : isNonEmptyString(value.activeRepoUuid)
        ? value.activeRepoUuid.trim()
        : fallbackConfig.activeRepoUuid
  const activeRepoUuid =
    requestedActiveRepoUuid !== null
    && repositories.some((repository) => repository.uuid === requestedActiveRepoUuid)
      ? requestedActiveRepoUuid
      : null

  const globalConfig = normalizeGlobalConfig(value.global)

  return {
    activeRepoUuid,
    repositories,
    global: {
      ...globalConfig,
      variables: mergeGlobalAndLegacyVariables(
        globalConfig.variables,
        legacyRepositoryVariableEntries(value.repositories, repositories, activeRepoUuid),
      ),
    },
    agent: normalizeAgentGlobalConfig(value.agent),
  }
}

export function getActiveRepositoryConfig(config: SynapseConfig): SynapseRepositoryConfig | null {
  if (config.activeRepoUuid === null) {
    return null
  }

  return config.repositories.find((repository) => repository.uuid === config.activeRepoUuid) ?? null
}

export function getContentDir(
  repository: SynapseRepositoryConfig,
  contentType: SynapseContentType,
): string {
  const legacyConfigKey = getContentTypeDefinition(contentType).repositoryDir.legacyConfigKey

  return repository.contentDirs?.[contentType]
    ?? (legacyConfigKey ? repository[legacyConfigKey] : undefined)
    ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[contentType]
}

export function applySynapseConfigPatch(
  config: SynapseConfig,
  patch: SynapseConfigPatch,
): SynapseConfig {
  const nextGlobal = patch.global
    ? {
        ...config.global,
        ...patch.global,
        projects: patch.global.projects ?? config.global.projects,
    }
    : config.global
  const nextAgent = patch.agent
    ? {
        ...config.agent,
        ...patch.agent,
      }
    : config.agent

  return sanitizeSynapseConfig({
    ...config,
    activeRepoUuid:
      patch.activeRepoUuid !== undefined ? patch.activeRepoUuid : config.activeRepoUuid,
    repositories: patch.repositories ?? config.repositories,
    global: nextGlobal,
    agent: nextAgent,
  })
}
