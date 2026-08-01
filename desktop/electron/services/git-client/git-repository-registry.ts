import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitRepository } from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import {
  copyToTimestampedBackup,
  isFileNotFoundError,
  writeJsonFileAtomic,
} from "../../runtime/data-repo/atomic-io"
import { normalizeRepositoryPath, normalizeRepositoryPathForCompare } from "./git-path-utils"
import {
  createGitOperationId,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  repositoryLogMeta,
} from "./git-logging"

type RegistryFile = {
  readonly version: 1
  readonly repositories: readonly SynapseGitRepository[]
}

class RegistryCorruptionError extends Error {}

type AddLocalInput = {
  readonly name: string
  readonly localPath: string
}

type RegistryDeps = {
  readonly logger?: Pick<StructuredLogger, "error" | "info">
  readonly platform?: NodeJS.Platform | string
  readonly resolveGitRoot: (localPath: string) => Promise<string>
  readonly userDataPath: string
  readonly now?: () => Date
}

function registryFilePath(userDataPath: string): string {
  return path.join(userDataPath, "git-client", "repositories.json")
}

function registryBackupFilePath(filePath: string): string {
  return `${filePath}.bak`
}

function sanitizeName(name: string, localPath: string): string {
  const trimmed = name.trim()
  return trimmed || path.basename(localPath) || "Git 仓库"
}

async function readRegistryFile(filePath: string): Promise<RegistryFile | null> {
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!isRegistryFile(parsed)) {
      throw new RegistryCorruptionError("Git repository registry has an invalid structure.")
    }
    return parsed
  } catch (error) {
    if (isFileNotFoundError(error)) return null
    if (error instanceof SyntaxError) {
      throw new RegistryCorruptionError("Git repository registry contains invalid JSON.", { cause: error })
    }
    throw error
  }
}

function isRegistryFile(value: unknown): value is RegistryFile {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Array.isArray(record.repositories)) return false
  return record.repositories.every((repository) => {
    if (!repository || typeof repository !== "object") return false
    const item = repository as Record<string, unknown>
    return typeof item.id === "string" && item.id.trim().length > 0
      && typeof item.name === "string" && item.name.trim().length > 0
      && typeof item.localPath === "string" && item.localPath.trim().length > 0
      && typeof item.addedAt === "string" && item.addedAt.trim().length > 0
      && (item.lastOpenedAt === null || typeof item.lastOpenedAt === "string")
  })
}

async function readRegistry(filePath: string, logger: Pick<StructuredLogger, "error" | "info">): Promise<RegistryFile> {
  let primaryMissing = false
  try {
    const primary = await readRegistryFile(filePath)
    if (primary) return primary
    primaryMissing = true
  } catch (error) {
    if (!(error instanceof RegistryCorruptionError)) throw error

    const quarantinedPath = await copyToTimestampedBackup(filePath)
    logger.error("Git repository registry is malformed.", {
      quarantined: Boolean(quarantinedPath),
    })
  }

  try {
    const backup = await readRegistryFile(registryBackupFilePath(filePath))
    if (backup) {
      await writeJsonFileAtomic(filePath, backup)
      logger.info("Recovered Git repository registry from backup.", {
        repositoryCount: backup.repositories.length,
      })
      return backup
    }
  } catch (backupError) {
    if (backupError instanceof RegistryCorruptionError) {
      await copyToTimestampedBackup(registryBackupFilePath(filePath)).catch(() => null)
      logger.error("Git repository registry backup is malformed.", {
        errorName: backupError.name,
      })
      throw new Error("Git 仓库列表及其备份均已损坏，请从隔离副本恢复。", { cause: backupError })
    }
    throw backupError
  }

  if (primaryMissing) {
    return { version: 1, repositories: [] }
  }

  throw new Error("Git 仓库列表已损坏且没有可用备份，请从隔离副本恢复。")
}

async function writeRegistry(filePath: string, data: RegistryFile): Promise<void> {
  const previous = await readRegistryFile(filePath).catch((error) => {
    if (error instanceof RegistryCorruptionError) return null
    throw error
  })
  if (previous) {
    await writeJsonFileAtomic(registryBackupFilePath(filePath), previous)
  }
  await writeJsonFileAtomic(filePath, data)
}

export function createGitRepositoryRegistry(deps: RegistryDeps) {
  const filePath = registryFilePath(deps.userDataPath)
  const now = deps.now ?? (() => new Date())
  const platform = deps.platform ?? process.platform
  let mutationChain = Promise.resolve()

  async function withRegistryMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = mutationChain.catch(() => undefined).then(task)
    mutationChain = run.then(() => undefined, () => undefined)
    return run
  }

  return {
    async list(): Promise<SynapseGitRepository[]> {
      const data = await readRegistry(filePath, deps.logger ?? noopLogger)
      return [...data.repositories]
    },

    async addLocal(input: AddLocalInput): Promise<SynapseGitRepository> {
      const operation = "git.repository.addLocal"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      const selectedPath = normalizeRepositoryPath(input.localPath, { platform })
      const localPath = normalizeRepositoryPath(await deps.resolveGitRoot(selectedPath), { platform })
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, {
        repoPath: localPath,
        nameLength: input.name.length,
      })
      try {
        return await withRegistryMutation(async () => {
          const data = await readRegistry(filePath, deps.logger ?? noopLogger)
          const localPathKey = normalizeRepositoryPathForCompare(localPath, { platform })
          const existing = data.repositories.find((repository) => (
            normalizeRepositoryPathForCompare(repository.localPath, { platform }) === localPathKey
          ))
          if (existing) {
            logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
              ...repositoryLogMeta(existing),
              deduplicated: true,
            })
            return existing
          }

          const repository: SynapseGitRepository = {
            id: randomUUID(),
            name: sanitizeName(input.name, localPath),
            localPath,
            addedAt: now().toISOString(),
            lastOpenedAt: null,
          }
          await writeRegistry(filePath, { version: 1, repositories: [...data.repositories, repository] })
          logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, repositoryLogMeta(repository))
          return repository
        })
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repoPath: localPath,
          startedAt,
          error,
          extra: {
            nameLength: input.name.length,
          },
        })
        throw error
      }
    },

    async markOpened(repositoryId: string): Promise<void> {
      const operation = "git.repository.open"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      try {
        await withRegistryMutation(async () => {
          const data = await readRegistry(filePath, deps.logger ?? noopLogger)
          const repository = data.repositories.find((item) => item.id === repositoryId)
          const openedAt = now().toISOString()
          await writeRegistry(filePath, {
            version: 1,
            repositories: data.repositories.map((repository) => (
              repository.id === repositoryId ? { ...repository, lastOpenedAt: openedAt } : repository
            )),
          })
          logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
            repositoryId,
            ...(repository ? repositoryLogMeta(repository) : {}),
            found: Boolean(repository),
          })
        })
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId,
          startedAt,
          error,
        })
        throw error
      }
    },

    async remove(repositoryId: string): Promise<void> {
      const operation = "git.repository.remove"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, {
        repositoryId,
      })
      try {
        await withRegistryMutation(async () => {
          const data = await readRegistry(filePath, deps.logger ?? noopLogger)
          const repository = data.repositories.find((item) => item.id === repositoryId)

          if (!repository) {
            logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
              repositoryId,
              found: false,
            })
            return
          }

          await writeRegistry(filePath, {
            version: 1,
            repositories: data.repositories.filter((repository) => repository.id !== repositoryId),
          })
          logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
            ...repositoryLogMeta(repository),
          })
        })
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId,
          startedAt,
          error,
        })
        throw error
      }
    },
  }
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
}

export type GitRepositoryRegistry = ReturnType<typeof createGitRepositoryRegistry>
