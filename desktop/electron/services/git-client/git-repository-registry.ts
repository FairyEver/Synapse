import { randomUUID } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitRepository } from "../../../src/types/git"
import type { SynapseGitRepositoryRemoveInput } from "../../../src/types/git"
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

type AddLocalInput = {
  readonly name: string
  readonly localPath: string
}

type RegistryDeps = {
  readonly logger?: Pick<StructuredLogger, "error" | "info">
  readonly platform?: NodeJS.Platform | string
  readonly userDataPath: string
  readonly now?: () => Date
  readonly trashItem?: (targetPath: string) => Promise<void>
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
    const parsed = JSON.parse(raw) as Partial<RegistryFile>
    return {
      version: 1,
      repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
    }
  } catch (error) {
    if (isFileNotFoundError(error)) return null
    throw error
  }
}

async function readRegistry(filePath: string, logger: Pick<StructuredLogger, "error" | "info">): Promise<RegistryFile> {
  try {
    return await readRegistryFile(filePath) ?? { version: 1, repositories: [] }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error

    const quarantinedPath = await copyToTimestampedBackup(filePath)
    await rm(filePath, { force: true }).catch(() => undefined)
    logger.error("Git repository registry is malformed.", {
      quarantined: Boolean(quarantinedPath),
    })

    try {
      const backup = await readRegistryFile(registryBackupFilePath(filePath))
      if (backup) {
        logger.info("Recovered Git repository registry from backup.", {
          repositoryCount: backup.repositories.length,
        })
        return backup
      }
    } catch (backupError) {
      if (backupError instanceof SyntaxError) {
        await copyToTimestampedBackup(registryBackupFilePath(filePath)).catch(() => null)
        logger.error("Git repository registry backup is malformed.", {
          errorName: backupError.name,
        })
      } else {
        throw backupError
      }
    }

    return { version: 1, repositories: [] }
  }
}

async function writeRegistry(filePath: string, data: RegistryFile): Promise<void> {
  const previous = await readRegistryFile(filePath).catch((error) => {
    if (error instanceof SyntaxError) return null
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
      const localPath = normalizeRepositoryPath(input.localPath, { platform })
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

    async remove(input: SynapseGitRepositoryRemoveInput): Promise<void> {
      const operation = "git.repository.remove"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, {
        repositoryId: input.repositoryId,
        mode: input.mode,
      })
      try {
        await withRegistryMutation(async () => {
          const data = await readRegistry(filePath, deps.logger ?? noopLogger)
          const repository = data.repositories.find((item) => item.id === input.repositoryId)

          if (!repository) {
            logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
              repositoryId: input.repositoryId,
              mode: input.mode,
              found: false,
            })
            return
          }

          if (input.mode === "trash-local") {
            if (!deps.trashItem) {
              throw new Error("移到废纸篓功能不可用。")
            }
            await deps.trashItem(repository.localPath)
          }

          await writeRegistry(filePath, {
            version: 1,
            repositories: data.repositories.filter((repository) => repository.id !== input.repositoryId),
          })
          logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
            ...repositoryLogMeta(repository),
            mode: input.mode,
          })
        })
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId: input.repositoryId,
          startedAt,
          error,
          extra: {
            mode: input.mode,
          },
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
