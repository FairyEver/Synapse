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

  it("redacts user variable values before logging config update patches", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-redaction-"))
    mocks.userDataPath = dir

    try {
      await configStore.update({
        global: {
          variables: [{ name: "TOKEN", value: "super-secret-value", description: "api token" }],
        },
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

  it("summarizes quick input content before logging config update patches", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-redaction-"))
    mocks.userDataPath = dir

    try {
      await configStore.update({
        global: {
          quickInputs: [{ id: "quick-1", content: "token=secret-value\n内部资料", directSend: true }],
        },
      })

      const updatingCall = mocks.logger.info.mock.calls.find(([message]) => message === "Updating config.")
      expect(updatingCall).toBeDefined()

      const loggedPatch = JSON.stringify(updatingCall?.[1])
      expect(loggedPatch).toContain("quick-1")
      expect(loggedPatch).toContain("contentLength")
      expect(loggedPatch).not.toContain("token=secret-value")
      expect(loggedPatch).not.toContain("内部资料")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("summarizes recent Slash Skills without logging their names", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-redaction-"))
    mocks.userDataPath = dir

    try {
      await configStore.update({
        agent: { recentSlashSkills: ["private-client-skill", "review-code"] },
      })

      const updatingCall = mocks.logger.info.mock.calls.find(([message]) => message === "Updating config.")
      const loggedPatch = JSON.stringify(updatingCall?.[1])
      expect(loggedPatch).toContain("recentSlashSkillCount")
      expect(loggedPatch).not.toContain("private-client-skill")
      expect(loggedPatch).not.toContain("review-code")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
