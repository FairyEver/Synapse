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
})

