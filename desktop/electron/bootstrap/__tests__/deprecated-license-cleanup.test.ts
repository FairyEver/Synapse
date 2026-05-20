import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  clearDeprecatedLicenseStore,
  getDeprecatedLicenseStorePath,
} from "../deprecated-license-cleanup"

describe("deprecated license cleanup", () => {
  it("removes the old encrypted license namespace file", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-license-cleanup-"))
    const licenseStorePath = getDeprecatedLicenseStorePath(userDataPath)
    await mkdir(path.dirname(licenseStorePath), { recursive: true })
    await writeFile(licenseStorePath, "old encrypted license payload")

    await clearDeprecatedLicenseStore(userDataPath)

    await expect(readFile(licenseStorePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("does not warn when the old license namespace file is already gone", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-license-cleanup-"))
    const logger = { info: vi.fn(), warn: vi.fn() }

    await clearDeprecatedLicenseStore(userDataPath, logger)

    expect(logger.warn).not.toHaveBeenCalled()
  })
})
