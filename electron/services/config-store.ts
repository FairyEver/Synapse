import { app } from "electron"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { applySynapseConfigPatch, createDefaultConfig, sanitizeSynapseConfig } from "../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../src/types/config"

const CONFIG_FILE_NAME = "config.json"

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
      return structuredClone(this.cachedConfig)
    }

    const config = await this.readFromDisk()
    this.cachedConfig = config

    return structuredClone(config)
  }

  async update(patch: SynapseConfigPatch): Promise<SynapseConfig> {
    const currentConfig = await this.readCachedOrDisk()
    const nextConfig = applySynapseConfigPatch(currentConfig, patch)

    await this.persist(nextConfig)
    this.cachedConfig = nextConfig

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
      const fileContent = await readFile(filePath, "utf8")
      const parsedConfig = JSON.parse(fileContent) as unknown
      const normalizedConfig = sanitizeSynapseConfig(parsedConfig)

      await this.persist(normalizedConfig)

      return normalizedConfig
    } catch (error) {
      if (isFileNotFoundError(error)) {
        const defaultConfig = createDefaultConfig()

        await this.persist(defaultConfig)

        return defaultConfig
      }

      if (error instanceof SyntaxError) {
        await this.backupInvalidConfig(filePath)

        const defaultConfig = createDefaultConfig()

        await this.persist(defaultConfig)

        return defaultConfig
      }

      throw error
    }
  }

  private async backupInvalidConfig(filePath: string): Promise<void> {
    try {
      await rename(filePath, createBackupFilePath(filePath))
    } catch {
      // Best effort backup. Persisting a fresh config still keeps the app usable.
    }
  }

  private async persist(config: SynapseConfig): Promise<void> {
    const filePath = this.getFilePath()

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  }
}

export const configStore = new ConfigStore()
