import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitRepository } from "../../../src/types/git"
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
  readonly userDataPath: string
  readonly now?: () => Date
}

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
  const now = deps.now ?? (() => new Date())

  return {
    async list(): Promise<SynapseGitRepository[]> {
      const data = await readRegistry(filePath)
      return [...data.repositories]
    },

    async addLocal(input: AddLocalInput): Promise<SynapseGitRepository> {
      const data = await readRegistry(filePath)
      const localPath = normalizeRepositoryPath(input.localPath)
      const existing = data.repositories.find((repository) => repository.localPath === localPath)
      if (existing) return existing

      const repository: SynapseGitRepository = {
        id: randomUUID(),
        name: sanitizeName(input.name, localPath),
        localPath,
        addedAt: now().toISOString(),
        lastOpenedAt: null,
      }
      await writeRegistry(filePath, { version: 1, repositories: [...data.repositories, repository] })
      return repository
    },

    async markOpened(repositoryId: string): Promise<void> {
      const data = await readRegistry(filePath)
      const openedAt = now().toISOString()
      await writeRegistry(filePath, {
        version: 1,
        repositories: data.repositories.map((repository) => (
          repository.id === repositoryId ? { ...repository, lastOpenedAt: openedAt } : repository
        )),
      })
    },

    async remove(repositoryId: string): Promise<void> {
      const data = await readRegistry(filePath)
      await writeRegistry(filePath, {
        version: 1,
        repositories: data.repositories.filter((repository) => repository.id !== repositoryId),
      })
    },
  }
}

export type GitRepositoryRegistry = ReturnType<typeof createGitRepositoryRegistry>
