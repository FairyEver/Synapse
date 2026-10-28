import { mkdtempSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const root = mkdtempSync(path.join(os.tmpdir(), "platform-media-"))
vi.mock("../config/env", () => ({
  isPlatformMediaCosConfigured: () => false,
  loadEnv: () => ({ driveLocalRoot: root }),
}))

import { PlatformMediaStorage } from "./platform-media-storage"

describe("PlatformMediaStorage.putObject", () => {
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it("writes raw bytes to the local platform-media root", async () => {
    const storage = new PlatformMediaStorage()
    await storage.putObject("notification-images/abc", Buffer.from([1, 2, 3]), "image/png")
    const written = await readFile(path.join(root, "platform-media", "notification-images", "abc"))
    expect([...written]).toEqual([1, 2, 3])
  })
})
