import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { packageMacCompiled } from "../../release/package-mac-compiled.mjs"

test("finalizes the metadata only after builder has completed its final async write", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "synapse-package-order-"))
  try {
    await packageMacCompiled({ outDir, buildApp: async () => {
      await new Promise((resolve) => setImmediate(resolve))
      await writeFile(path.join(outDir, "latest-mac.yml"), "version: 1.0.80\n")
      return [path.join(outDir, "Synapse-1.0.80-mac-arm64.zip")]
    } })
    assert.match(await readFile(path.join(outDir, "latest-mac.yml"), "utf8"), /minimumSystemVersion: 22.0.0/)
  } finally { await rm(outDir, { recursive: true, force: true }) }
})
test("does not replace previous metadata when the builder fails", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "synapse-package-failure-"))
  try {
    const file = path.join(outDir, "latest-mac.yml")
    await writeFile(file, "previous metadata")
    await assert.rejects(packageMacCompiled({ outDir, buildApp: async () => { throw new Error("build failed") } }), /build failed/)
    assert.equal(await readFile(file, "utf8"), "previous metadata")
  } finally { await rm(outDir, { recursive: true, force: true }) }
})
