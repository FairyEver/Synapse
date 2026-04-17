import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

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

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", reject)

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim() || null)
        return
      }

      const message = stderr.trim() || stdout.trim()
      reject(new Error(message || "Git 探测失败。"))
    })
  })
}

async function resolveGitRootPath(localPath: string): Promise<string | null> {
  try {
    return await runGitProbe(localPath, ["rev-parse", "--show-toplevel"])
  } catch {
    return null
  }
}

class RepositoryStore {
  async getRepositoryState(repository: SynapseRepositoryConfig): Promise<SynapseRepositoryLocalState> {
    const localPath = repository.localPath
    const repositoryExists = await pathExists(localPath)

    if (!repositoryExists) {
      return {
        repositoryUuid: repository.uuid,
        localPath,
        status: "missing",
        isGitRepository: false,
        gitRootPath: null,
      }
    }

    const gitRootPath = await resolveGitRootPath(localPath)

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
