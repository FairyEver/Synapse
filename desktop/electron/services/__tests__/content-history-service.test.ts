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
import type { SynapseContentType } from "../../../src/types/content"

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

async function writeContentVersion(
  root: string,
  contentType: SynapseContentType,
  contentId: string,
  files: Array<{ originalName: string; sha256: string; size: number }>,
): Promise<SynapseRepositoryConfig> {
  const contentDir = `${contentType}s`
  const historyPath = path.join(root, contentDir, contentId, "history", "20260430000000Z__user__abc123")
  await mkdir(historyPath, { recursive: true })
  await writeJson(path.join(root, contentDir, contentId, "meta.json"), {
    schemaVersion: 1,
    id: contentId,
    type: contentType,
    createdBy: "user",
    createdByDisplayName: "User",
    createdAt: "2026-04-30T00:00:00.000Z",
  })
  await writeJson(path.join(historyPath, "snapshot.json"), {
    schemaVersion: 1,
    title: "Content",
    description: "Description",
    category: "test",
    icon: "file-text",
    iconBg: "default",
    modifiedBy: "user",
    modifiedByDisplayName: "User",
    modifiedAt: "2026-04-30T00:00:00.000Z",
    deleted: false,
  })
  await writeFile(path.join(historyPath, "main.md"), "# Content\n", "utf8")
  await writeJson(path.join(historyPath, "attachments.json"), {
    schemaVersion: 1,
    files,
  })

  return {
    uuid: `repo-${contentId}`,
    name: "Repo",
    localPath: root,
    contentDirs: { [contentType]: contentDir },
  }
}

describe("contentHistoryService", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("normalizes persisted attachment names before exposing details", async () => {
    const root = await createTempRoot()
    const repository = await writeContentVersion(root, "skill", "skill-1", [
      { originalName: "../CON.txt", sha256: "a".repeat(64), size: 1 },
      { originalName: "aux. /bad:name?.txt", sha256: "b".repeat(64), size: 2 },
      { originalName: "outside.txt", sha256: "../../outside.txt", size: 3 },
      { originalName: "bad.txt", sha256: "not-a-digest", size: 4 },
    ])

    const detail = await contentHistoryService.readCurrentDetail(repository, "skill", "skill-1")

    expect(detail?.hasEnv).toBe(false)
    expect(detail?.attachments.map((attachment) => attachment.originalName)).toEqual([
      "_CON.txt",
      "_aux/bad_name_.txt",
    ])
  })

  it("marks skills with a root env example in the current version", async () => {
    const root = await createTempRoot()
    const repository = await writeContentVersion(root, "skill", "skill-env", [
      { originalName: ".env.example", sha256: "a".repeat(64), size: 0 },
    ])

    const detail = await contentHistoryService.readCurrentDetail(repository, "skill", "skill-env")

    expect(detail?.hasEnv).toBe(true)
  })

  it("does not mark non-skill content as env-enabled", async () => {
    const root = await createTempRoot()
    const repository = await writeContentVersion(root, "rule", "rule-env", [
      { originalName: ".env.example", sha256: "a".repeat(64), size: 0 },
    ])

    const detail = await contentHistoryService.readCurrentDetail(repository, "rule", "rule-env")

    expect(detail?.hasEnv).toBe(false)
  })
})
