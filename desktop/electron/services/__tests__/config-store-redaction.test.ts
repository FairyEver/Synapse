import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  userDataPath: "",
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => mocks.userDataPath,
    getAppPath: () => mocks.userDataPath,
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

import { configStore } from "../config-store"

describe("ConfigStore log redaction", () => {
  beforeEach(() => {
    Object.assign(configStore as unknown as {
      cachedConfig: null
      initialized: boolean
      namespace: null
    }, {
      cachedConfig: null,
      initialized: false,
      namespace: null,
    })
    mocks.userDataPath = ""
    for (const fn of Object.values(mocks.logger)) fn.mockReset()
  })

  it("redacts repository variable values before logging config update patches", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-redaction-"))
    mocks.userDataPath = dir

    try {
      await configStore.update({
        repositories: [{
          uuid: "repo-1",
          name: "Repo",
          localPath: "/repo",
          contentDirs: {},
          variables: [{ name: "TOKEN", value: "super-secret-value", description: "api token" }],
        }],
      })

      const updatingCall = mocks.logger.info.mock.calls.find(([message]) => message === "Updating config.")
      expect(updatingCall).toBeDefined()

      const loggedPatch = JSON.stringify(updatingCall?.[1])
      expect(loggedPatch).toContain("[redacted]")
      expect(loggedPatch).toContain("TOKEN")
      expect(loggedPatch).not.toContain("super-secret-value")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
