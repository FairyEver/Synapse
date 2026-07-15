import { lstat, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertInsideBindingRoot,
  createDriveSyncDirectoryTarget,
  localPathCollisionKey,
  localPathsOverlap,
  normalizeLocalPath,
  pathCollisionKey,
  prepareDriveSyncTargetPath,
  resolveBindingChildPath,
  toDriveSyncRelativePath,
} from "../drive-sync-paths"

describe("drive sync path utilities", () => {
  it("normalizes local paths without changing the root identity", () => {
    expect(normalizeLocalPath("/Users/me/docs/../docs")).toBe("/Users/me/docs")
  })

  it("returns POSIX-style relative paths inside a binding root", () => {
    expect(toDriveSyncRelativePath("/Users/me/docs", "/Users/me/docs/specs/a.md")).toBe("specs/a.md")
    expect(toDriveSyncRelativePath("/Users/me/docs", "/Users/me/docs")).toBe("")
    expect(toDriveSyncRelativePath("/Users/me/docs", "/Users/me/docs/..draft.md")).toBe("..draft.md")
    expect(toDriveSyncRelativePath("/Users/me/docs", "/Users/me/docs/..cache/file.txt")).toBe("..cache/file.txt")
  })

  it("rejects paths outside the binding root", () => {
    expect(() => assertInsideBindingRoot("/Users/me/docs", "/Users/me/other/a.md")).toThrow("同步路径超出绑定目录。")
    expect(() => resolveBindingChildPath("/Users/me/docs", "../secret.md")).toThrow("同步路径超出绑定目录。")
  })

  it("resolves child paths inside the binding root", () => {
    expect(resolveBindingChildPath("/Users/me/docs", "specs/a.md")).toBe("/Users/me/docs/specs/a.md")
    expect(resolveBindingChildPath("/Users/me/docs", "..draft.md")).toBe("/Users/me/docs/..draft.md")
    expect(resolveBindingChildPath("/Users/me/docs", "..cache/file.txt")).toBe("/Users/me/docs/..cache/file.txt")
  })

  it("prepares valid dot-prefixed download paths inside the real binding root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-paths-root-"))
    try {
      const target = path.join(root, "..cache", "file.txt")
      await expect(prepareDriveSyncTargetPath(root, target)).resolves.toBe(target)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("creates stable case-insensitive collision keys", () => {
    expect(pathCollisionKey("Docs/Spec.md")).toBe("docs/spec.md")
  })

  it("detects local path collisions across case variants and descendants", () => {
    expect(localPathCollisionKey("/Users/me/Docs")).toBe(pathCollisionKey(normalizeLocalPath("/Users/me/Docs")))
    expect(localPathsOverlap("/Users/me/Docs", "/users/me/docs")).toBe(true)
    expect(localPathsOverlap("/Users/me/Docs", "/USERS/me/docs/Nested")).toBe(true)
    expect(localPathsOverlap("/Users/me/Docs", "/Users/me/Other")).toBe(false)
  })

  it("does not create file parent directories through symlinked binding children", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-paths-root-"))
    const outside = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-paths-outside-"))
    try {
      await symlink(outside, path.join(root, "linked"), "dir")

      await expect(prepareDriveSyncTargetPath(root, path.join(root, "linked", "nested", "file.txt")))
        .rejects.toThrow("同步路径包含符号链接，已停止写入。")
      await expect(lstat(path.join(outside, "nested"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it("does not create directory targets through symlinked binding children", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-paths-root-"))
    const outside = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-paths-outside-"))
    try {
      await symlink(outside, path.join(root, "linked"), "dir")

      await expect(createDriveSyncDirectoryTarget(root, path.join(root, "linked", "nested", "folder")))
        .rejects.toThrow("同步路径包含符号链接，已停止写入。")
      await expect(lstat(path.join(outside, "nested"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
