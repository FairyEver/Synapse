import { app } from "electron"
import path from "node:path"
import { existsSync } from "node:fs"
import { readFile, rename, writeFile } from "node:fs/promises"
import {
  applySynapseConfigPatch,
  createDefaultConfig,
  sanitizeSynapseConfig,
} from "../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../src/types/config"
import { createMainLogger } from "./log-store"
import { JsonNamespace } from "../runtime/data-repo/backends/json"

const logger = createMainLogger("service.config-store")

// Schema version for core.config namespace
const CORE_CONFIG_SCHEMA_VERSION = 1

// Namespace name for config in DataRepository
const CORE_CONFIG_NAMESPACE = "core.config"

// Legacy config file path (for migration)
const LEGACY_CONFIG_FILE_NAME = "config.json"

// Create DataRepository and config namespace
function createConfigNamespace(): JsonNamespace<SynapseConfig> {
  const userDataPath = app.getPath("userData")
  const dataV1Path = path.join(userDataPath, "data-v1")
  const filePath = path.join(dataV1Path, `${CORE_CONFIG_NAMESPACE}.json`)

  return new JsonNamespace({
    name: CORE_CONFIG_NAMESPACE,
    schemaVersion: CORE_CONFIG_SCHEMA_VERSION,
    backend: "json",
    filePath,
    defaults: createDefaultConfig,
  })
}

// Migrate legacy config.json to DataRepository
async function migrateConfigIfNeeded(namespace: JsonNamespace<SynapseConfig>): Promise<void> {
  const userDataPath = app.getPath("userData")
  const legacyConfigPath = path.join(userDataPath, LEGACY_CONFIG_FILE_NAME)

  if (!existsSync(legacyConfigPath)) {
    // No legacy config to migrate
    return
  }

  // Check if config already exists in DataRepository with actual user data
  const existing = await namespace.getSingleton()
  const hasActualUserData = existing !== null && existing.repositories.length > 0
  if (hasActualUserData) {
    // Config already migrated (has repositories), just rename the legacy file
    try {
      await rename(legacyConfigPath, `${legacyConfigPath}.migrated`)
      logger.info("Legacy config file already migrated, renamed to .migrated")
    } catch {
      // Ignore errors
    }
    return
  }

  logger.info("[migration] Found legacy config.json, starting migration to DataRepository")

  try {
    // Read legacy config
    const legacyContent = await readFile(legacyConfigPath, "utf8")
    const legacyConfig = JSON.parse(legacyContent) as unknown

    // Backup legacy config
    const backupPath = `${legacyConfigPath}.v0.bak`
    await writeFile(backupPath, legacyContent)
    logger.info("[migration] Legacy config backed up to config.json.v0.bak")

    // Validate and sanitize
    const normalizedConfig = sanitizeSynapseConfig(legacyConfig)

    // Write to DataRepository
    await namespace.setSingleton(normalizedConfig)
    logger.info("[migration] Config migrated to DataRepository namespace", {
      namespace: CORE_CONFIG_NAMESPACE,
    })

    // Rename legacy file to prevent re-migration
    await rename(legacyConfigPath, `${legacyConfigPath}.migrated`)
    logger.info("[migration] Legacy config renamed to config.json.migrated")

    logger.info("[migration] config v0 → v1, backup: config.json.v0.bak")
  } catch (error) {
    logger.error("[migration] Failed to migrate legacy config", { error })
    // Continue with default config - migration failure shouldn't block startup
  }
}

class ConfigStore {
  private cachedConfig: SynapseConfig | null = null
  private namespace: JsonNamespace<SynapseConfig> | null = null
  private initialized = false

  private getNamespace(): JsonNamespace<SynapseConfig> {
    if (!this.namespace) {
      this.namespace = createConfigNamespace()
    }
    return this.namespace
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    const namespace = this.getNamespace()

    // Run migration from legacy config.json if needed
    await migrateConfigIfNeeded(namespace)

    // Ensure namespace has data (create default if empty)
    const existing = await namespace.getSingleton()
    if (existing === null) {
      logger.info("No existing config found, creating default config")
      const defaultConfig = createDefaultConfig()
      await namespace.setSingleton(defaultConfig)
    }

    this.initialized = true
    logger.info("ConfigStore initialized")
  }

  async load(): Promise<SynapseConfig> {
    await this.initialize()

    if (this.cachedConfig) {
      logger.debug("Returning cached config.")
      const normalizedConfig = sanitizeSynapseConfig(this.cachedConfig)
      this.cachedConfig = normalizedConfig
      return structuredClone(normalizedConfig)
    }

    logger.info("Loading config from DataRepository.")
    const namespace = this.getNamespace()
    const config = await namespace.getSingleton()

    if (config === null) {
      // This shouldn't happen after initialization, but handle it gracefully
      logger.warn("Config not found in DataRepository, creating default")
      const defaultConfig = createDefaultConfig()
      await namespace.setSingleton(defaultConfig)
      this.cachedConfig = defaultConfig
      return structuredClone(defaultConfig)
    }

    const normalizedConfig = sanitizeSynapseConfig(config)
    if (JSON.stringify(normalizedConfig) !== JSON.stringify(config)) {
      await namespace.setSingleton(normalizedConfig)
      logger.info("Config normalized after load.", {
        activeRepoUuid: normalizedConfig.activeRepoUuid,
        repositoryCount: normalizedConfig.repositories.length,
      })
    }

    this.cachedConfig = normalizedConfig
    return structuredClone(normalizedConfig)
  }

  async update(patch: SynapseConfigPatch): Promise<SynapseConfig> {
    await this.initialize()

    logger.info("Updating config.", patch)
    const currentConfig = await this.readCachedOrNamespace()
    const nextConfig = applySynapseConfigPatch(currentConfig, patch)

    const namespace = this.getNamespace()
    await namespace.setSingleton(nextConfig)
    this.cachedConfig = nextConfig

    logger.info("Config persisted after update.", {
      activeRepoUuid: nextConfig.activeRepoUuid,
      repositoryCount: nextConfig.repositories.length,
    })

    return structuredClone(nextConfig)
  }

  async replace(rawConfig: unknown): Promise<SynapseConfig> {
    await this.initialize()

    if (typeof rawConfig !== "object" || rawConfig === null) {
      throw new Error("备份文件里的配置格式不对。")
    }

    const nextConfig = sanitizeSynapseConfig(rawConfig)

    const namespace = this.getNamespace()
    await namespace.setSingleton(nextConfig)
    this.cachedConfig = nextConfig

    logger.info("Config replaced from backup.", {
      activeRepoUuid: nextConfig.activeRepoUuid,
      repositoryCount: nextConfig.repositories.length,
    })

    return structuredClone(nextConfig)
  }

  // Export config for backup (DataRepository format)
  async exportForBackup(): Promise<{
    format: "synapse-backup-v1"
    exportedAt: string
    namespaces: Array<{
      name: string
      schemaVersion: number
      encrypted: boolean
      data: { singleton: SynapseConfig; items: [] }
    }>
  }> {
    await this.initialize()

    const config = await this.load()

    return {
      format: "synapse-backup-v1",
      exportedAt: new Date().toISOString(),
      namespaces: [
        {
          name: CORE_CONFIG_NAMESPACE,
          schemaVersion: CORE_CONFIG_SCHEMA_VERSION,
          encrypted: false,
          data: {
            singleton: config,
            items: [],
          },
        },
      ],
    }
  }

  // Import config from backup (DataRepository format)
  async importFromBackup(payload: {
    format: string
    namespaces: Array<{
      name: string
      data?: { singleton?: SynapseConfig }
    }>
  }): Promise<SynapseConfig> {
    await this.initialize()

    if (payload.format !== "synapse-backup-v1") {
      throw new Error(`不支持的备份格式: ${payload.format}`)
    }

    const configEntry = payload.namespaces.find((n) => n.name === CORE_CONFIG_NAMESPACE)
    if (!configEntry?.data?.singleton) {
      throw new Error("备份文件中未找到配置数据")
    }

    const config = configEntry.data.singleton
    const normalizedConfig = sanitizeSynapseConfig(config)

    const namespace = this.getNamespace()
    await namespace.setSingleton(normalizedConfig)
    this.cachedConfig = normalizedConfig

    logger.info("Config imported from backup.", {
      activeRepoUuid: normalizedConfig.activeRepoUuid,
      repositoryCount: normalizedConfig.repositories.length,
    })

    return structuredClone(normalizedConfig)
  }

  private async readCachedOrNamespace(): Promise<SynapseConfig> {
    return this.load()
  }

  /**
   * Synchronous access to the cached config. Only safe to call AFTER initialize() / load()
   * has completed (guaranteed by service dependency ordering in descriptors.ts).
   * Used by services that need the current config in synchronous getters (e.g. WorkflowService repo path).
   */
  loadSync(): SynapseConfig {
    if (!this.cachedConfig) {
      throw new Error("ConfigStore.loadSync() called before config was loaded — check service dependency ordering")
    }
    const normalizedConfig = sanitizeSynapseConfig(this.cachedConfig)
    this.cachedConfig = normalizedConfig
    return normalizedConfig
  }
}

// Singleton instance
export const configStore = new ConfigStore()
