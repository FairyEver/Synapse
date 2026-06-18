import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitRepository } from "../../../src/types/git"
import type { SynapseGitRepositoryRemoveInput } from "../../../src/types/git"
import {
  createGitLogger,
  createGitOperation,
  gitRepositoryLogMeta,
  logGitOperationFailure,
  logGitOperationStart,
  logGitOperationSuccess,
  sanitizeGitText,
  type GitLogger,
} from "./git-log-utils"
import { normalizeRepositoryPath } from "./git-path-utils"

type RegistryFile = {
  readonly version: 1
  readonly repositories: readonly SynapseGitRepository[]
}

type AddLocalInput = {
  readonly name: string
  readonly localPath: string
}

type RegistryDeps = {
  readonly logger?: GitLogger
  readonly userDataPath: string
  readonly now?: () => Date
  readonly trashItem?: (targetPath: string) => Promise<void>
}

const defaultLogger = createGitLogger("git.repository")

function registryFilePath(userDataPath: string): string {
  return path.join(userDataPath, "git-client", "repositories.json")
}

function sanitizeName(name: string, localPath: string): string {
  const trimmed = name.trim()
  return trimmed || path.basename(localPath) || "Git 仓库"
}

async function readRegistry(filePath: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<RegistryFile>
    return {
      version: 1,
      repositories: Array.isArray(parsed.repositories) ? parsed.repositories : [],
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, repositories: [] }
    }
    throw error
  }
}

async function writeRegistry(filePath: string, data: RegistryFile): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

export function createGitRepositoryRegistry(deps: RegistryDeps) {
  const filePath = registryFilePath(deps.userDataPath)
  const logger = deps.logger ?? defaultLogger
  const now = deps.now ?? (() => new Date())

  return {
    async list(): Promise<SynapseGitRepository[]> {
      const data = await readRegistry(filePath)
      return [...data.repositories]
    },

    async addLocal(input: AddLocalInput): Promise<SynapseGitRepository> {
      const operation = createGitOperation("git.repository.addLocal")
      const data = await readRegistry(filePath)
      const localPath = normalizeRepositoryPath(input.localPath)
      const existing = data.repositories.find((repository) => repository.localPath === localPath)
      logGitOperationStart(logger, "Git operation started.", operation, undefined, {
        repoPath: sanitizeGitText(localPath),
      })
      if (existing) {
        logGitOperationSuccess(logger, "Git operation completed.", operation, existing, {
          alreadyRegistered: true,
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
      try {
        await writeRegistry(filePath, { version: 1, repositories: [...data.repositories, repository] })
        logGitOperationSuccess(logger, "Git operation completed.", operation, repository, {
          alreadyRegistered: false,
        })
        return repository
      } catch (error) {
        logGitOperationFailure(logger, "Git operation failed.", operation, error, repository)
        throw error
      }
    },

    async markOpened(repositoryId: string): Promise<void> {
      const operation = createGitOperation("git.repository.open")
      const data = await readRegistry(filePath)
      const openedAt = now().toISOString()
      const repository = data.repositories.find((item) => item.id === repositoryId)
      try {
        await writeRegistry(filePath, {
          version: 1,
          repositories: data.repositories.map((item) => (
            item.id === repositoryId ? { ...item, lastOpenedAt: openedAt } : item
          )),
        })
        logger.info("Git operation completed.", {
          operation: operation.operation,
          operationId: operation.operationId,
          ...(repository ? gitRepositoryLogMeta(repository) : { repoId: repositoryId }),
        })
      } catch (error) {
        logGitOperationFailure(logger, "Git operation failed.", operation, error, repository)
        throw error
      }
    },

    async remove(input: SynapseGitRepositoryRemoveInput): Promise<void> {
      const operation = createGitOperation("git.repository.remove")
      const data = await readRegistry(filePath)
      const repository = data.repositories.find((item) => item.id === input.repositoryId)

      if (!repository) {
        logger.warn("Git operation skipped because repository record is missing.", {
          operation: operation.operation,
          operationId: operation.operationId,
          removeMode: input.mode,
          repoId: input.repositoryId,
        })
        return
      }

      logGitOperationStart(logger, "Git operation started.", operation, repository, {
        removeMode: input.mode,
      })

      try {
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
        logGitOperationSuccess(logger, "Git operation completed.", operation, repository, {
          removeMode: input.mode,
        })
      } catch (error) {
        logGitOperationFailure(logger, "Git operation failed.", operation, error, repository, {
          removeMode: input.mode,
        })
        throw error
      }
    },
  }
}

export type GitRepositoryRegistry = ReturnType<typeof createGitRepositoryRegistry>
