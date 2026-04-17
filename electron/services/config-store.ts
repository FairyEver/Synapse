import { app } from "electron"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  applySynapseConfigPatch,
  createDefaultConfig,
  hasRecoverableSynapseConfigFormatError,
  sanitizeSynapseConfig,
} from "../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../src/types/config"
import { createMainLogger } from "./log-store"

const CONFIG_FILE_NAME = "config.json"
const logger = createMainLogger("service.config-store")

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function createBackupFilePath(filePath: string): string {
  const extension = path.extname(filePath)
  const baseName = path.basename(filePath, extension)
  const directory = path.dirname(filePath)

  return path.join(directory, `${baseName}.invalid-${Date.now()}${extension}`)
}

class ConfigStore {
  private cachedConfig: SynapseConfig | null = null

  getFilePath(): string {
    return path.join(app.getPath("userData"), CONFIG_FILE_NAME)
  }

  async load(): Promise<SynapseConfig> {
    if (this.cachedConfig) {
      logger.debug("Returning cached config.")
      return structuredClone(this.cachedConfig)
    }

    logger.info("Loading config from disk.")
    const config = await this.readFromDisk()
    this.cachedConfig = config

    return structuredClone(config)
  }

  async update(patch: SynapseConfigPatch): Promise<SynapseConfig> {
    logger.info("Updating config.", patch)
    const currentConfig = await this.readCachedOrDisk()
    const nextConfig = applySynapseConfigPatch(currentConfig, patch)

    await this.persist(nextConfig)
    this.cachedConfig = nextConfig

    logger.info("Config persisted after update.", {
      activeRepoUuid: nextConfig.activeRepoUuid,
      repositoryCount: nextConfig.repositories.length,
    })

    return structuredClone(nextConfig)
  }

  private async readCachedOrDisk(): Promise<SynapseConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig
    }

    const config = await this.readFromDisk()
    this.cachedConfig = config

    return config
  }

  private async readFromDisk(): Promise<SynapseConfig> {
    const filePath = this.getFilePath()

    await mkdir(path.dirname(filePath), { recursive: true })

    try {
      logger.debug("Reading config file.", { filePath })
      const fileContent = await readFile(filePath, "utf8")
      const parsedConfig = JSON.parse(fileContent) as unknown
      const shouldBackupConfig = hasRecoverableSynapseConfigFormatError(parsedConfig)

      if (shouldBackupConfig) {
        logger.warn("Config file has recoverable format issues. Backing it up.", { filePath })
        await this.backupInvalidConfig(filePath)
      }

      const normalizedConfig = sanitizeSynapseConfig(parsedConfig)

      await this.persist(normalizedConfig)
      logger.info("Config file sanitized and loaded.", {
        activeRepoUuid: normalizedConfig.activeRepoUuid,
        repositoryCount: normalizedConfig.repositories.length,
      })

      return normalizedConfig
    } catch (error) {
      if (isFileNotFoundError(error)) {
        logger.warn("Config file not found. Creating default config.", { filePath })
        const defaultConfig = createDefaultConfig()

        await this.persist(defaultConfig)

        return defaultConfig
      }

      if (error instanceof SyntaxError) {
        logger.error("Config file contains invalid JSON. Backing it up and resetting.", error)
        await this.backupInvalidConfig(filePath)

        const defaultConfig = createDefaultConfig()

        await this.persist(defaultConfig)

        return defaultConfig
      }

      logger.error("Failed to read config file.", error)
      throw error
    }
  }

  private async backupInvalidConfig(filePath: string): Promise<void> {
    try {
      await rename(filePath, createBackupFilePath(filePath))
      logger.info("Backed up invalid config file.", { filePath })
    } catch {
      // Best effort backup. Persisting a fresh config still keeps the app usable.
      logger.warn("Failed to back up invalid config file.", { filePath })
    }
  }

  private async persist(config: SynapseConfig): Promise<void> {
    const filePath = this.getFilePath()

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
    logger.debug("Config written to disk.", { filePath })
  }
}

export const configStore = new ConfigStore()
