import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createEditorWriteErrorLogMeta,
  formatEditorWriteFailure,
  replaceDirectoryAtomically,
  replaceFileAtomically,
} from "../editor-file-write-utils"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => logStoreMock.logger,
}))

describe("editor file write utils", () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    logStoreMock.logger.info.mockClear()
    logStoreMock.logger.warn.mockClear()
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })))
  })

  it("projects write errors without raw filesystem messages", () => {
    const error = Object.assign(
      new Error("rename /Users/alice/private/token-dir accessToken=secret Authorization: Bearer raw-token"),
      { code: "EACCES" },
    )

    const meta = createEditorWriteErrorLogMeta(error)
    const serialized = JSON.stringify(meta)

    expect(meta).toEqual({
      errorName: "Error",
      errorCode: "EACCES",
    })
    expect(serialized).not.toContain("/Users/alice")
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("raw-token")
  })

  it("formats write failures without exposing raw paths or secrets to the UI", () => {
    const formatted = formatEditorWriteFailure(
      new Error("write /Users/alice/private/skill.md apiKey=secret"),
      "/Users/alice/private/skill.md",
    )

    expect(formatted.message).toBe("写入失败，请稍后重试。")
    expect(formatted.message).not.toContain("/Users/alice")
    expect(formatted.message).not.toContain("secret")
  })

  it("logs atomic write success without the full target path", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-write-"))
    tempDirs.push(tempDir)
    const targetPath = path.join(tempDir, "rules", "private-rule.md")

    await replaceFileAtomically(targetPath, "# Rule")

    await expect(readFile(targetPath, "utf8")).resolves.toBe("# Rule\n")
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Wrote file atomically.", {
      targetName: "private-rule.md",
    })
    const serializedLogs = JSON.stringify(logStoreMock.logger.info.mock.calls)
    expect(serializedLogs).not.toContain(tempDir)
    expect(serializedLogs).not.toContain(targetPath)
  })

  it("preserves a concurrent target and moved backup when the post-move hook fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-write-"))
    tempDirs.push(tempDir)
    const targetPath = path.join(tempDir, "skill")
    let movedTargetPath = ""
    await mkdir(targetPath)
    await writeFile(path.join(targetPath, "old-marker.txt"), "old", "utf8")

    await expect(replaceDirectoryAtomically(
      targetPath,
      async (stagingDirectoryPath) => {
        await writeFile(path.join(stagingDirectoryPath, "new-marker.txt"), "new", "utf8")
      },
      {
        afterMoveExistingTarget: async (backupPath) => {
          movedTargetPath = backupPath
          await mkdir(targetPath)
          await writeFile(path.join(targetPath, "concurrent-marker.txt"), "concurrent", "utf8")
          throw new Error("post-move validation failed")
        },
      },
    )).rejects.toThrow("原目标自动恢复失败")

    await expect(readFile(path.join(targetPath, "concurrent-marker.txt"), "utf8"))
      .resolves.toBe("concurrent")
    await expect(readFile(path.join(movedTargetPath, "old-marker.txt"), "utf8"))
      .resolves.toBe("old")
    await expect(readFile(path.join(targetPath, "new-marker.txt")))
      .rejects.toMatchObject({ code: "ENOENT" })
    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Failed to safely restore atomic swap backup",
      expect.objectContaining({ errorName: "Error", targetName: "skill" }),
    )
  })

  it("rejects a target directory that appears during pre-swap validation", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-write-"))
    tempDirs.push(tempDir)
    const targetPath = path.join(tempDir, "skill")
    let concurrentTargetInode = 0n

    await expect(replaceDirectoryAtomically(
      targetPath,
      async (stagingDirectoryPath) => {
        await writeFile(path.join(stagingDirectoryPath, "new-marker.txt"), "new", "utf8")
      },
      {
        beforeSwap: async () => {
          await mkdir(targetPath)
          concurrentTargetInode = (await stat(targetPath, { bigint: true })).ino
        },
      },
    )).rejects.toThrow("atomic swap target state changed")

    expect((await stat(targetPath, { bigint: true })).ino).toBe(concurrentTargetInode)
    await expect(readFile(path.join(targetPath, "new-marker.txt")))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects a dangling target symlink that appears during pre-swap validation", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-write-"))
    tempDirs.push(tempDir)
    const targetPath = path.join(tempDir, "skill")

    await expect(replaceDirectoryAtomically(
      targetPath,
      async (stagingDirectoryPath) => {
        await writeFile(path.join(stagingDirectoryPath, "new-marker.txt"), "new", "utf8")
      },
      {
        beforeSwap: async () => {
          await symlink(path.join(tempDir, "missing-target"), targetPath)
        },
      },
    )).rejects.toThrow("atomic swap target state changed")

    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true)
  })

  it("rejects an existing target directory that disappears during pre-swap validation", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-write-"))
    tempDirs.push(tempDir)
    const targetPath = path.join(tempDir, "skill")
    await mkdir(targetPath)

    await expect(replaceDirectoryAtomically(
      targetPath,
      async (stagingDirectoryPath) => {
        await writeFile(path.join(stagingDirectoryPath, "new-marker.txt"), "new", "utf8")
      },
      {
        beforeSwap: async () => {
          await rm(targetPath, { recursive: true })
        },
      },
    )).rejects.toThrow("atomic swap target state changed")

    await expect(stat(targetPath)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
