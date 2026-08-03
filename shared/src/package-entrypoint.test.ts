import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

describe("package entrypoint", () => {
  it("does not load CommonJS-only modules from the ESM root entrypoint", async () => {
    const entrypoint = await readFile(new URL("../dist/index.js", import.meta.url), "utf8")
    const driveEntrypoint = await readFile(new URL("../dist/drive.js", import.meta.url), "utf8")

    expect(entrypoint).not.toContain("versioned-data-migrator.cjs")
    expect(driveEntrypoint).not.toContain("drive-sync-constants.cjs")
  })
})
