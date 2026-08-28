import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SkillRepositoryInstallManifest } from "@synapse/shared"
import { serializeSkillFrontmatter } from "../../../src/definitions/editor/shared-skill-frontmatter"
import type { SynapseSkillRepositoryPreparedSource } from "../../../src/types/skill-repository-install"

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-skill-repository-${name}`),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock("../account-service", () => {
  class AccountAuthenticationRequiredError extends Error {}

  return {
    AccountAuthenticationRequiredError,
    accountService: {
      getState: () => ({ status: "unauthenticated" }),
      fetchAuthenticated: vi.fn(),
    },
  }
})

vi.mock("../live-client-id-store", () => ({
  LiveClientIdStore: class {
    getOrCreate = vi.fn().mockResolvedValue("client-1")
  },
}))

import { SkillRepositoryInstallService } from "../skill-repository-install-service"

type PreparedInstallFixture = {
  readonly directoryPath: string
  readonly manifest: SkillRepositoryInstallManifest
  readonly sessionId: string
  readonly source: SynapseSkillRepositoryPreparedSource
}

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-cloud-skill-install-"))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("SkillRepositoryInstallService", () => {
  it("separates SKILL.md frontmatter before editor installation", async () => {
    const directoryPath = await createTempRoot()
    const mainFile = "content/SKILL.md"
    const mainContent = [
      "---",
      "name: cloud-skill",
      "description: Install from the cloud.",
      "---",
      "",
      "# Cloud Skill",
      "",
      "Run the cloud workflow.",
      "",
    ].join("\n")
    await mkdir(path.join(directoryPath, "content"), { recursive: true })
    await writeFile(path.join(directoryPath, mainFile), mainContent, "utf8")

    const manifest: SkillRepositoryInstallManifest = {
      schemaVersion: 1,
      repositoryId: "repository-1",
      repositoryName: "cloud-skill",
      ownerHandle: "owner",
      title: "Cloud Skill",
      mainFile,
      files: [{
        path: mainFile,
        size: Buffer.byteLength(mainContent, "utf8"),
        sha256: "a".repeat(64),
        kind: "text",
      }],
    }
    const source: SynapseSkillRepositoryPreparedSource = {
      id: "prepared-1",
      repositoryId: manifest.repositoryId,
      repositoryName: manifest.repositoryName,
      ownerHandle: manifest.ownerHandle,
      title: manifest.title,
      mainFile,
      mainContent,
      files: manifest.files.map((file) => ({
        path: file.path,
        size: file.size,
        kind: file.kind,
      })),
    }
    const service = new SkillRepositoryInstallService({
      accountService: {
        getState: () => ({ status: "authenticated" }) as never,
        fetchAuthenticated: vi.fn(),
      },
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      tempRoot: directoryPath,
    })
    const internals = service as unknown as {
      preparedById: Map<string, PreparedInstallFixture>
    }
    internals.preparedById.set(source.id, {
      directoryPath,
      manifest,
      sessionId: "session-1",
      source,
    })

    const detail = await service.readPreparedSkill(source.id, source.repositoryId)

    expect(detail.description).toBe("Install from the cloud.")
    expect(detail.content).toBe("# Cloud Skill\n\nRun the cloud workflow.")
    const installedMainFile = serializeSkillFrontmatter({
      name: source.repositoryName,
      description: detail.description,
    }) + detail.content
    expect(installedMainFile.match(/^---$/gmu)).toHaveLength(2)
  })
})
