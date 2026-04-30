import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-content-history-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import { contentHistoryService } from "../content-history-service"
import type { SynapseRepositoryConfig } from "../../../src/types/config"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `synapse-content-history-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  tempRoots.push(root)
  return root
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

describe("contentHistoryService", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("normalizes persisted attachment names before exposing details", async () => {
    const root = await createTempRoot()
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: { skill: "skills" },
    }
    const historyPath = path.join(root, "skills", "skill-1", "history", "20260430000000Z__user__abc123")
    await mkdir(historyPath, { recursive: true })
    await writeJson(path.join(root, "skills", "skill-1", "meta.json"), {
      schemaVersion: 1,
      id: "skill-1",
      type: "skill",
      createdBy: "user",
      createdByDisplayName: "User",
      createdAt: "2026-04-30T00:00:00.000Z",
    })
    await writeJson(path.join(historyPath, "snapshot.json"), {
      schemaVersion: 1,
      title: "Skill",
      description: "Description",
      category: "test",
      icon: "wrench",
      iconBg: "default",
      modifiedBy: "user",
      modifiedByDisplayName: "User",
      modifiedAt: "2026-04-30T00:00:00.000Z",
      deleted: false,
    })
    await writeFile(path.join(historyPath, "main.md"), "# Skill\n", "utf8")
    await writeJson(path.join(historyPath, "attachments.json"), {
      schemaVersion: 1,
      files: [
        { originalName: "../CON.txt", sha256: "a".repeat(64), size: 1 },
        { originalName: "aux. /bad:name?.txt", sha256: "b".repeat(64), size: 2 },
      ],
    })

    const detail = await contentHistoryService.readCurrentDetail(repository, "skill", "skill-1")

    expect(detail?.attachments.map((attachment) => attachment.originalName)).toEqual([
      "_CON.txt",
      "_aux/bad_name_.txt",
    ])
  })
})
