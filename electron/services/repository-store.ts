import { app } from "electron"
import { access, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

class RepositoryStore {
  getRepositoriesRootPath(): string {
    return path.join(app.getPath("userData"), "repos")
  }

  getRepositoryPath(repositoryUuid: string): string {
    return path.join(this.getRepositoriesRootPath(), repositoryUuid)
  }

  async ensureRepositoriesRootPath(): Promise<void> {
    await mkdir(this.getRepositoriesRootPath(), { recursive: true })
  }

  async getRepositoryState(repositoryUuid: string): Promise<SynapseRepositoryLocalState> {
    const localPath = this.getRepositoryPath(repositoryUuid)
    const repositoryExists = await pathExists(localPath)
    const gitDirectoryPath = path.join(localPath, ".git")
    const gitDirectoryExists = await pathExists(gitDirectoryPath)
    const shallowFileExists = gitDirectoryExists
      ? await pathExists(path.join(gitDirectoryPath, "shallow"))
      : false

    return {
      repositoryUuid,
      localPath,
      status: gitDirectoryExists ? "ready" : repositoryExists ? "invalid" : "missing",
      isShallow: gitDirectoryExists && shallowFileExists,
    }
  }

  async removeLocalRepository(repositoryUuid: string): Promise<void> {
    await rm(this.getRepositoryPath(repositoryUuid), {
      recursive: true,
      force: true,
    })
  }
}

export const repositoryStore = new RepositoryStore()
