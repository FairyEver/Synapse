import { spawn } from "node:child_process"
import { watch, type FSWatcher } from "node:fs"
import { isFileNotFoundError, isPermissionError, pathExists } from "./fs-utils"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"
import { createMainLogger } from "./log-store"

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
  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      childProcess.kill("SIGTERM")
      reject(new Error("Git 探测超时。"))
    }, GIT_PROBE_TIMEOUT_MS)

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    childProcess.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (code === 0) {
        resolve(stdout.trim() || null)
        return
      }

      const message = stderr.trim() || stdout.trim()
      reject(new Error(message || "Git 探测失败。"))
    })
  })
}

class RepositoryStore {
  private watchers = new Map<string, FSWatcher>()
  private disappearedListeners = new Set<(repositoryUuid: string) => void>()

  onRepositoryDisappeared(listener: (repositoryUuid: string) => void): () => void {
    this.disappearedListeners.add(listener)
    return () => { this.disappearedListeners.delete(listener) }
  }

  watchRepository(repository: SynapseRepositoryConfig): void {
    if (this.watchers.has(repository.uuid)) {
      return
    }

    try {
      const watcher = watch(repository.localPath, { persistent: false }, () => {
        void this.checkDirectoryExists(repository)
      })

      watcher.on("error", () => {
        // Directory likely deleted — verify and notify
        void this.checkDirectoryExists(repository)
      })

      this.watchers.set(repository.uuid, watcher)
      logger.debug("Started watching repository directory.", {
        repositoryUuid: repository.uuid,
      })
    } catch {
      // Directory may already be gone at watch time
      void this.checkDirectoryExists(repository)
    }
  }

  unwatchRepository(uuid: string): void {
    const watcher = this.watchers.get(uuid)

    if (watcher) {
      watcher.close()
      this.watchers.delete(uuid)
    }
  }

  unwatchAll(): void {
    for (const [uuid, watcher] of this.watchers) {
      watcher.close()
      this.watchers.delete(uuid)
    }
  }

  private async checkDirectoryExists(repository: SynapseRepositoryConfig): Promise<void> {
    try {
      const exists = await pathExists(repository.localPath)

      if (!exists) {
        logger.warn("Watched repository directory disappeared.", {
          repositoryUuid: repository.uuid,
        })
        this.unwatchRepository(repository.uuid)

        for (const listener of this.disappearedListeners) {
          listener(repository.uuid)
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
    const repositoryExists = await pathExists(localPath)
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
