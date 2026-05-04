import { spawn } from "node:child_process"
import { watch, type FSWatcher } from "node:fs"
import { isFileNotFoundError, pathExists } from "./fs-utils"
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
        localPath: repository.localPath,
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
    const exists = await pathExists(repository.localPath)

    if (!exists) {
      logger.warn("Watched repository directory disappeared.", {
        repositoryUuid: repository.uuid,
        localPath: repository.localPath,
      })
      this.unwatchRepository(repository.uuid)

      for (const listener of this.disappearedListeners) {
        listener(repository.uuid)
      }
    }
  }

  async getRepositoryState(repository: SynapseRepositoryConfig): Promise<SynapseRepositoryLocalState> {
    const localPath = repository.localPath
    logger.debug("Checking repository state.", {
      repositoryUuid: repository.uuid,
      localPath,
    })
    const repositoryExists = await pathExists(localPath)

    if (!repositoryExists) {
      logger.warn("Repository path does not exist.", {
        repositoryUuid: repository.uuid,
        localPath,
      })
      return {
        repositoryUuid: repository.uuid,
        localPath,
        status: "missing",
        isGitRepository: false,
        gitRootPath: null,
      }
    }

    const gitRootPath = await resolveGitRootPath(localPath)
    logger.debug("Repository state resolved.", {
      repositoryUuid: repository.uuid,
      gitRootPath,
      isGitRepository: gitRootPath !== null,
    })

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
