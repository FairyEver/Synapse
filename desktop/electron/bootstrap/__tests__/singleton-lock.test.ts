import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
  },
  existsSync: vi.fn(),
  readlinkSync: vi.fn(),
  rmSync: vi.fn(),
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: mocks.app,
}))

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readlinkSync: mocks.readlinkSync,
  rmSync: mocks.rmSync,
}))

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

import { clearStaleSingletonLock } from "../singleton-lock"

describe("clearStaleSingletonLock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.app.getPath.mockReturnValue("/userData")
    mocks.existsSync.mockReturnValue(true)
  })

  it("does nothing when no singleton lock exists", () => {
    mocks.existsSync.mockReturnValue(false)

    expect(clearStaleSingletonLock()).toBe(false)

    expect(mocks.rmSync).not.toHaveBeenCalled()
  })

  it("keeps singleton files when the symlink points at a running process", () => {
    mocks.readlinkSync.mockReturnValue(`synapse-${process.pid}`)

    expect(clearStaleSingletonLock()).toBe(false)

    expect(mocks.rmSync).not.toHaveBeenCalled()
  })

  it("cleans regular singleton files so startup can retry the lock", () => {
    mocks.readlinkSync.mockImplementation(() => {
      throw new Error("not a symlink")
    })

    expect(clearStaleSingletonLock()).toBe(true)

    expect(mocks.rmSync).toHaveBeenCalledWith("/userData/SingletonLock", { force: true })
    expect(mocks.rmSync).toHaveBeenCalledWith("/userData/SingletonSocket", { force: true })
    expect(mocks.rmSync).toHaveBeenCalledWith("/userData/SingletonCookie", { force: true })
  })
})
