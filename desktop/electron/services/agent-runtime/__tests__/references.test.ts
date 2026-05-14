import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  renderReferenceView,
  resolveLocalReference,
} from "../references"

describe("agent local references", () => {
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

  it("renders a bounded file view", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-show-"))
    await fs.writeFile(path.join(workspace, "file.ts"), "one\ntwo\nthree\n")

    await expect(renderReferenceView("file.ts:2", workspace, { context: 0 }))
      .resolves.toContain("   2 | two")
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
