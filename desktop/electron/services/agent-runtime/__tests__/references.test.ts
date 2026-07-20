import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Dirent } from "node:fs"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  renderReferenceView,
  resolveLocalReference,
} from "../references"

describe("agent local references", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves references inside the workspace and rejects outside paths", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-ref-"))
    await fs.mkdir(path.join(workspace, "src"))
    await fs.writeFile(path.join(workspace, "src", "app.ts"), "one\ntwo\nthree\n")

    expect(resolveLocalReference("src/app.ts:2", workspace)).toEqual(expect.objectContaining({
      relativePath: "src/app.ts",
      line: 2,
    }))
    expect(resolveLocalReference("../outside.ts", workspace)).toBeNull()
  })

  it("resolves outside paths when opening a local reference explicitly allows them", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-ref-workspace-"))
    const outside = path.join(path.dirname(workspace), "Easy Worklog", "待发送", "工作总结.md")

    expect(resolveLocalReference(outside, workspace, { allowOutsideWorkspace: true }))
      .toEqual(expect.objectContaining({ path: outside }))
  })

  it("resolves sentence-punctuated local references from agent messages", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-ref-punctuated-"))
    await fs.mkdir(path.join(workspace, "src"))
    await fs.writeFile(path.join(workspace, "src", "app.ts"), "one\ntwo\nthree\n")

    expect(resolveLocalReference("src/app.ts:2.", workspace)).toEqual(expect.objectContaining({
      relativePath: "src/app.ts",
      line: 2,
    }))
    expect(resolveLocalReference("[app](src/app.ts:3),", workspace)).toEqual(expect.objectContaining({
      relativePath: "src/app.ts",
      line: 3,
    }))
  })

  it("renders a bounded file view", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-show-"))
    await fs.writeFile(path.join(workspace, "file.ts"), "one\ntwo\nthree\n")

    await expect(renderReferenceView("file.ts:2", workspace, { context: 0 }))
      .resolves.toContain("   2 | two")
  })

  it("stops reading directory previews at the configured entry limit", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-show-dir-"))
    const entries = Array.from({ length: 100 }, (_value, index) => fakeDirent(`file-${String(index).padStart(3, "0")}.txt`))
    const read = vi.fn(async () => entries.shift() ?? null)
    const close = vi.fn(async () => undefined)
    vi.spyOn(fs, "opendir").mockResolvedValue({ read, close } as never)

    const rendered = await renderReferenceView(".", workspace, { maxEntries: 5 })

    expect(read).toHaveBeenCalledTimes(5)
    expect(close).toHaveBeenCalledOnce()
    expect(rendered).toContain("file file-000.txt")
    expect(rendered).toContain("file file-004.txt")
    expect(rendered).not.toContain("file-005.txt")
  })

  it("does not expose absolute workspace paths when a reference is missing", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-show-missing-"))

    await expect(renderReferenceView("missing.ts", workspace))
      .rejects.toThrow("Reference not found: missing.ts")
    await expect(renderReferenceView("missing.ts", workspace))
      .rejects.not.toThrow(workspace)
  })

  it("does not render workspace symlinks that resolve outside the workspace", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-ref-workspace-"))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-ref-outside-"))
    const outsideFile = path.join(outside, "secret.txt")
    await fs.writeFile(outsideFile, "outside secret\n")
    await fs.symlink(outsideFile, path.join(workspace, "linked-secret.txt"))

    await expect(renderReferenceView("linked-secret.txt", workspace))
      .resolves.toBe("Reference is outside the workspace or invalid.")
  })
})

function fakeDirent(name: string): Dirent {
  return {
    name,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isDirectory: () => false,
    isFIFO: () => false,
    isFile: () => true,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as Dirent
}
