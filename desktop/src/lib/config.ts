import {
  DEFAULT_CONFIG,
  DEFAULT_CONTENT_SORT_ORDER,
  DEFAULT_FAVORITES,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_LOCALE,
  DEFAULT_RECENTLY_VIEWED,
  DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
  DEFAULT_THEME_MODE,
} from "../constants/defaults"
import {
  CONTENT_TYPE_DEFINITIONS,
  getContentTypeDefinition,
} from "../config/content-types"
import { SYNAPSE_CONTENT_SORT_OPTIONS, SYNAPSE_LOCALE_OPTIONS, SYNAPSE_THEME_MODE_OPTIONS } from "../types/config"
import { normalizeSynapseLocale } from "./locale"
import type { SynapseContentType } from "../types/content"
import type { SynapseProviderEntry } from "../types/provider"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseContentSortOrder,
  SynapseFavorites,
  SynapseGlobalConfig,
  SynapseLocale,
  SynapseProjectConfig,
  SynapseWorkspaceBinding,
  SynapseRecentlyViewed,
  SynapseRepositoryConfig,
  SynapseThemeMode,
  SynapseVariable,
} from "../types/config"

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

function isSynapseLocale(value: unknown): value is SynapseLocale {
  return typeof value === "string" && SYNAPSE_LOCALE_OPTIONS.includes(value as SynapseLocale)
}

function isSynapseContentSortOrder(value: unknown): value is SynapseContentSortOrder {
  return typeof value === "string" && SYNAPSE_CONTENT_SORT_OPTIONS.includes(value as SynapseContentSortOrder)
}

function asTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

function normalizeDirectoryName(value: unknown, fallback: string): string {
  const nextValue = asTrimmedString(value, fallback)

  return nextValue.length > 0 ? nextValue : fallback
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

  if (hasOwnKey(value, "mode") && typeof value.mode !== "string") {
    return true
  }

  if (hasOwnKey(value, "workDir") && typeof value.workDir !== "string") {
    return true
  }

  if (hasOwnKey(value, "workDirOverride") && typeof value.workDirOverride !== "string") {
    return true
  }

  if (hasOwnKey(value, "baseDir") && typeof value.baseDir !== "string") {
    return true
  }

  if (hasOwnKey(value, "source") && typeof value.source !== "string") {
    return true
  }

  if (hasOwnKey(value, "workspaceDirOverrides") && !isRecord(value.workspaceDirOverrides)) {
    return true
  }

  return false
}

function hasProviderConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "id") && typeof value.id !== "string") {
    return true
  }

  if (hasOwnKey(value, "name") && typeof value.name !== "string") {
    return true
  }

  if (hasOwnKey(value, "scope") && typeof value.scope !== "string") {
    return true
  }

  if (hasOwnKey(value, "secretRef") && typeof value.secretRef !== "string") {
    return true
  }

  return false
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

  if (hasOwnKey(value, "locale") && typeof value.locale !== "string") {
    return true
  }

  if (hasOwnKey(value, "favorites") && hasFavoritesFormatError(value.favorites)) {
    return true
  }

  if (!hasOwnKey(value, "projects")) {
    return (hasOwnKey(value, "workspaceBindings") && !Array.isArray(value.workspaceBindings))
      || (hasOwnKey(value, "providers") && !Array.isArray(value.providers))
  }

  if (!Array.isArray(value.projects)) {
    return true
  }

  return value.projects.some(hasProjectConfigFormatError)
    || (hasOwnKey(value, "workspaceBindings") && !Array.isArray(value.workspaceBindings))
    || (hasOwnKey(value, "providers") && (
      !Array.isArray(value.providers) || value.providers.some(hasProviderConfigFormatError)
    ))
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

  return {
    id,
    name,
    path: projectPath,
    ...(value.mode === "multi-workspace" || value.mode === "single" ? { mode: value.mode } : undefined),
    ...(isNonEmptyString(value.workDir) ? { workDir: value.workDir.trim() } : undefined),
    ...(isNonEmptyString(value.workDirOverride) ? { workDirOverride: value.workDirOverride.trim() } : undefined),
    ...(isNonEmptyString(value.baseDir) ? { baseDir: value.baseDir.trim() } : undefined),
    ...(value.source === "cc-connect" ? { source: "cc-connect" as const } : undefined),
    ...(isRecord(value.workspaceDirOverrides)
      ? { workspaceDirOverrides: normalizeStringRecord(value.workspaceDirOverrides) }
      : undefined),
  }
}

function normalizeStringRecord(value: Record<string, unknown>): Record<string, string> | undefined {
  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), typeof item === "string" ? item.trim() : ""] as const)
    .filter(([key, item]) => key.length > 0 && item.length > 0)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
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

  const variables = normalizeVariables(value.variables)

  return {
    uuid,
    name,
    localPath,
    contentDirs: resolveContentDirs(value),
    ...(variables ? { variables } : undefined),
  }
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

function stringRecord(value: Record<string, unknown>): Record<string, string> | undefined {
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([key, item]) => [key, item.trim()] as const)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function uniqueStrings(value: unknown[]): string[] | undefined {
  const values = Array.from(new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  ))

  return values.length > 0 ? values : undefined
}

function providerModels(value: unknown[]): SynapseProviderEntry["models"] | undefined {
  const models = value
    .filter(isRecord)
    .map((item) => ({
      model: asTrimmedString(item.model),
      ...(isNonEmptyString(item.alias) ? { alias: item.alias.trim() } : undefined),
    }))
    .filter((item) => item.model.length > 0)

  return models.length > 0 ? models : undefined
}

function providerModelLists(value: Record<string, unknown>): SynapseProviderEntry["agentModelLists"] | undefined {
  const entries = Object.entries(value)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([key, item]) => [key, providerModels(item)] as const)
    .filter((entry): entry is [string, NonNullable<SynapseProviderEntry["models"]>] => Boolean(entry[1]))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function providerCodexConfig(value: Record<string, unknown>): SynapseProviderEntry["codex"] | undefined {
  const httpHeaders = isRecord(value.httpHeaders) ? stringRecord(value.httpHeaders) : undefined
  const wireApi = isNonEmptyString(value.wireApi) ? value.wireApi.trim() : undefined

  if (!wireApi && !httpHeaders) {
    return undefined
  }

  return {
    ...(wireApi ? { wireApi } : undefined),
    ...(httpHeaders ? { httpHeaders } : undefined),
  }
}

function normalizeProviderConfig(value: unknown): SynapseProviderEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const id = asTrimmedString(value.id)
  const name = asTrimmedString(value.name)
  const scope = value.scope === "project" ? "project" : value.scope === "global" ? "global" : null

  if (!id || !name || value.schemaVersion !== 1 || value.kind !== "llm" || !scope) {
    return null
  }

  return {
    id,
    schemaVersion: 1,
    kind: "llm",
    name,
    scope,
    ...(isNonEmptyString(value.projectId) ? { projectId: value.projectId.trim() } : undefined),
    ...(isNonEmptyString(value.secretRef) ? { secretRef: value.secretRef.trim() } : undefined),
    ...(isNonEmptyString(value.baseUrl) ? { baseUrl: value.baseUrl.trim() } : undefined),
    ...(isNonEmptyString(value.model) ? { model: value.model.trim() } : undefined),
    ...(isNonEmptyString(value.thinking) ? { thinking: value.thinking.trim() } : undefined),
    ...(isRecord(value.env) && stringRecord(value.env) ? { env: stringRecord(value.env) } : undefined),
    ...(Array.isArray(value.agentTypes) && uniqueStrings(value.agentTypes) ? { agentTypes: uniqueStrings(value.agentTypes) } : undefined),
    ...(Array.isArray(value.models) && providerModels(value.models) ? { models: providerModels(value.models) } : undefined),
    ...(isRecord(value.endpoints) && stringRecord(value.endpoints) ? { endpoints: stringRecord(value.endpoints) } : undefined),
    ...(isRecord(value.agentModels) && stringRecord(value.agentModels) ? { agentModels: stringRecord(value.agentModels) } : undefined),
    ...(isRecord(value.agentModelLists) && providerModelLists(value.agentModelLists) ? { agentModelLists: providerModelLists(value.agentModelLists) } : undefined),
    ...(isRecord(value.codex) && providerCodexConfig(value.codex) ? { codex: providerCodexConfig(value.codex) } : undefined),
  }
}

function normalizeProviders(value: unknown): SynapseProviderEntry[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG.providers)
  }

  return dedupeByKey(
    value.map(normalizeProviderConfig).filter(isDefined),
    (provider) => provider.id,
  )
}

function normalizeWorkspaceBinding(value: unknown): SynapseWorkspaceBinding | null {
  if (!isRecord(value)) {
    return null
  }

  const id = asTrimmedString(value.id)
  const projectId = value.projectId === null ? null : asTrimmedString(value.projectId)
  const channelKey = asTrimmedString(value.channelKey)
  const channelName = asTrimmedString(value.channelName)
  const workspacePath = asTrimmedString(value.workspacePath)
  const boundAt = asTrimmedString(value.boundAt)

  if (!id || !channelKey || !workspacePath || !boundAt) {
    return null
  }

  return {
    id,
    projectId: projectId || null,
    channelKey,
    channelName,
    workspacePath,
    boundAt,
  }
}

function normalizeWorkspaceBindings(value: unknown): SynapseWorkspaceBinding[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG.workspaceBindings)
  }

  return dedupeByKey(
    value.map(normalizeWorkspaceBinding).filter(isDefined),
    (binding) => binding.id,
  )
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

function normalizeGlobalConfig(value: unknown): SynapseGlobalConfig {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG)
  }

  const projects = normalizeProjects(value.projects)
  const providers = normalizeProviders(value.providers)
  const workspaceBindings = normalizeWorkspaceBindings(value.workspaceBindings)
  const requestedDefaultProjectId = value.defaultProjectId
  const defaultProjectId = isNonEmptyString(requestedDefaultProjectId)
    && projects.some((project) => project.id === requestedDefaultProjectId.trim())
    ? requestedDefaultProjectId.trim()
    : null

  return {
    themeMode: normalizeThemeMode(value.themeMode, DEFAULT_THEME_MODE),
    locale: isSynapseLocale(value.locale)
      ? value.locale
      : normalizeSynapseLocale(value.language, DEFAULT_LOCALE),
    projects,
    providers,
    defaultProjectId,
    workspaceBindings,
    favorites: normalizeFavorites(value.favorites),
    recentlyViewed: normalizeRecentlyViewed(value.recentlyViewed),
    contentSortOrder: isSynapseContentSortOrder(value.contentSortOrder)
      ? value.contentSortOrder
      : DEFAULT_CONTENT_SORT_ORDER,
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

  return {
    activeRepoUuid,
    repositories,
    global: normalizeGlobalConfig(value.global),
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
        providers: patch.global.providers ?? config.global.providers,
        workspaceBindings: patch.global.workspaceBindings ?? config.global.workspaceBindings,
      }
    : config.global

  return sanitizeSynapseConfig({
    ...config,
    activeRepoUuid:
      patch.activeRepoUuid !== undefined ? patch.activeRepoUuid : config.activeRepoUuid,
    repositories: patch.repositories ?? config.repositories,
    global: nextGlobal,
  })
}
