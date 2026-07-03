import { watch, type FSWatcher } from "node:fs"
import { isFileNotFoundError, isPermissionError, pathExists } from "./fs-utils"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"
import { createMainLogger } from "./log-store"
import { runGitCommand } from "./git-command"

const logger = createMainLogger("service.repository-store")

function isNotGitRepositoryError(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

async function resolveGitRootPath(localPath: string): Promise<string | null> {
  try {
    return await runGitProbe(localPath, ["rev-parse", "--show-toplevel"])
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return null
    }

    throw error
  }
}

const GIT_PROBE_TIMEOUT_MS = 15_000

function runGitProbe(cwd: string, args: string[]): Promise<string | null> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage: "Git 探测失败。",
    timeoutMessage: "Git 探测超时。",
    timeoutMs: GIT_PROBE_TIMEOUT_MS,
  }).then((result) => result.stdout.trim() || null)
}

type RepositoryWatcherEntry = {
  readonly localPath: string
  readonly watcher: FSWatcher
}

export class RepositoryStore {
  private watchers = new Map<string, RepositoryWatcherEntry>()
  private disappearedListeners = new Set<(repositoryUuid: string) => void>()

  onRepositoryDisappeared(listener: (repositoryUuid: string) => void): () => void {
    this.disappearedListeners.add(listener)
    return () => { this.disappearedListeners.delete(listener) }
  }

  watchRepository(repository: SynapseRepositoryConfig): void {
    const existing = this.watchers.get(repository.uuid)
    if (existing?.localPath === repository.localPath) {
      return
    }
    if (existing) {
      this.unwatchRepository(repository.uuid)
    }

    try {
      const watcher = watch(repository.localPath, { persistent: false }, () => {
        void this.checkDirectoryExists(repository, { requireCurrentWatcher: true })
      })

      watcher.on("error", () => {
        // Directory likely deleted — verify and notify
        void this.checkDirectoryExists(repository, { requireCurrentWatcher: true })
      })

      this.watchers.set(repository.uuid, {
        localPath: repository.localPath,
        watcher,
      })
      logger.debug("Started watching repository directory.", {
        repositoryUuid: repository.uuid,
      })
    } catch {
      // Directory may already be gone at watch time
      void this.checkDirectoryExists(repository)
    }
  }

  reconcileRepositories(repositories: SynapseRepositoryConfig[]): void {
    const nextUuids = new Set(repositories.map((repository) => repository.uuid))

    for (const uuid of this.watchers.keys()) {
      if (!nextUuids.has(uuid)) {
        this.unwatchRepository(uuid)
      }
    }

    for (const repository of repositories) {
      this.watchRepository(repository)
    }
  }

  unwatchRepository(uuid: string): void {
    const entry = this.watchers.get(uuid)

    if (entry) {
      entry.watcher.close()
      this.watchers.delete(uuid)
    }
  }

  unwatchAll(): void {
    for (const [uuid, entry] of this.watchers) {
      entry.watcher.close()
      this.watchers.delete(uuid)
    }
  }

  private async checkDirectoryExists(
    repository: SynapseRepositoryConfig,
    options: { readonly requireCurrentWatcher?: boolean } = {},
  ): Promise<void> {
    try {
      const exists = await pathExists(repository.localPath)

      if (!exists) {
        if (options.requireCurrentWatcher && this.watchers.get(repository.uuid)?.localPath !== repository.localPath) {
          return
        }
        logger.warn("Watched repository directory disappeared.", {
          repositoryUuid: repository.uuid,
        })
        this.unwatchRepository(repository.uuid)

        for (const listener of this.disappearedListeners) {
          try {
            listener(repository.uuid)
          } catch (err) {
            logger.warn("Repository disappeared listener threw.", { repositoryUuid: repository.uuid, error: err })
          }
        }
      }
    } catch (error) {
      if (isPermissionError(error)) {
        logger.warn("Watched repository directory permission denied, watcher retained.", {
          repositoryUuid: repository.uuid,
        })
        // Directory still exists but is temporarily inaccessible — keep watcher
        return
      }
      logger.error("Watched repository directory check failed.", {
        repositoryUuid: repository.uuid,
        error,
      })
    }
  }

  async getRepositoryState(repository: SynapseRepositoryConfig): Promise<SynapseRepositoryLocalState> {
    const localPath = repository.localPath
    const t0 = Date.now()
    logger.info("getRepositoryState: starting.", { repositoryUuid: repository.uuid })

    const tPath = Date.now()
    let repositoryExists: boolean
    try {
      repositoryExists = await pathExists(localPath)
    } catch (error) {
      if (isPermissionError(error)) {
        logger.warn("Repository path is temporarily inaccessible.", {
          repositoryUuid: repository.uuid,
        })
        return {
          repositoryUuid: repository.uuid,
          localPath,
          status: "inaccessible",
          isGitRepository: false,
          gitRootPath: null,
        }
      }
      throw error
    }
    logger.info("getRepositoryState: pathExists done.", { repositoryExists, durationMs: Date.now() - tPath, repositoryUuid: repository.uuid })

    if (!repositoryExists) {
      logger.warn("Repository path does not exist.", {
        repositoryUuid: repository.uuid,
      })
      return {
        repositoryUuid: repository.uuid,
        localPath,
        status: "missing",
        isGitRepository: false,
        gitRootPath: null,
      }
    }

    const tGit = Date.now()
    logger.info("getRepositoryState: calling runGitProbe.", { repositoryUuid: repository.uuid })
    const gitRootPath = await resolveGitRootPath(localPath)
    logger.info("getRepositoryState: runGitProbe done.", { durationMs: Date.now() - tGit, totalDurationMs: Date.now() - t0, repositoryUuid: repository.uuid })

    return {
      repositoryUuid: repository.uuid,
      localPath,
      status: "ready",
      isGitRepository: gitRootPath !== null,
      gitRootPath,
    }
  }
}

export const repositoryStore = new RepositoryStore()
