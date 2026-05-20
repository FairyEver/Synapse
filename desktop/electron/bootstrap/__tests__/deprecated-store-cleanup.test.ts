import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  clearDeprecatedStores,
  getDeprecatedEncryptedStorePath,
} from "../deprecated-store-cleanup"

describe("deprecated store cleanup", () => {
  it("removes deprecated encrypted namespace files", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-store-cleanup-"))
    const storePath = getDeprecatedEncryptedStorePath(userDataPath, "core.license.bin")
    await mkdir(path.dirname(storePath), { recursive: true })
    await writeFile(storePath, "old encrypted payload")

    await clearDeprecatedStores(userDataPath)

    await expect(readFile(storePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("does not warn when deprecated encrypted namespace files are already gone", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-store-cleanup-"))
    const logger = { info: vi.fn(), warn: vi.fn() }

    await clearDeprecatedStores(userDataPath, logger)

    expect(logger.warn).not.toHaveBeenCalled()
  })
})
