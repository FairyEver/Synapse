import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  installService: {
    resolveInstallSession: vi.fn(),
    prepare: vi.fn(),
    recordComplete: vi.fn(),
  },
  setPreparedSourceProvider: vi.fn(),
}))

vi.mock("../../../services/content-store-install-service", () => ({
  contentStoreInstallService: mocks.installService,
}))

vi.mock("../../../services/content-install-service", () => ({
  contentInstallService: {
    setPreparedSourceProvider: mocks.setPreparedSourceProvider,
  },
}))

import { contentStoreInstallIpcModule } from "../ipc"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.installService.resolveInstallSession.mockResolvedValue({
    status: "ready",
    session: {
      id: "session-1",
      contentId: "content-1",
      versionId: "version-1",
      type: "skill",
      title: "Store Skill",
      packageSha256: "a".repeat(64),
      packageSize: "123",
      expiresAt: "2026-06-10T01:00:00.000Z",
    },
  })
  mocks.installService.prepare.mockResolvedValue({
    status: "prepared",
    source: {
      id: "prepared-1",
      contentId: "content-1",
      versionId: "version-1",
      type: "skill",
      title: "Store Skill",
      mainFile: "content/SKILL.md",
      mainContent: "# Store Skill\n",
      files: [{
        path: "content/SKILL.md",
        size: 14,
        kind: "text",
      }],
    },
  })
  mocks.installService.recordComplete.mockResolvedValue({ ok: true })
})

describe("contentStoreInstallIpcModule", () => {
  it("routes narrow resolve, prepare, and recordComplete requests", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:content-store-install:resolve", {
      sessionId: "session-1",
    })).resolves.toMatchObject({ status: "ready" })
    await expect(harness.invoke("synapse:content-store-install:prepare", {
      sessionId: "session-1",
    })).resolves.toMatchObject({ status: "prepared" })
    await expect(harness.invoke("synapse:content-store-install:record-complete", {
      sessionId: "session-1",
    })).resolves.toEqual({ ok: true })

    expect(mocks.installService.resolveInstallSession).toHaveBeenCalledWith("session-1")
    expect(mocks.installService.prepare).toHaveBeenCalledWith("session-1")
    expect(mocks.installService.recordComplete).toHaveBeenCalledWith("session-1")
  })

  it("rejects empty, extra, and client-controlled completion fields", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:content-store-install:resolve", {
      sessionId: "",
    })).rejects.toThrow()
    await expect(harness.invoke("synapse:content-store-install:prepare", {
      sessionId: "session-1",
      rawPackage: new Uint8Array([1]),
    })).rejects.toThrow()
    await expect(harness.invoke("synapse:content-store-install:record-complete", {
      sessionId: "session-1",
      clientInstanceId: "renderer-controlled",
    })).rejects.toThrow()

    expect(mocks.installService.resolveInstallSession).not.toHaveBeenCalled()
    expect(mocks.installService.prepare).not.toHaveBeenCalled()
    expect(mocks.installService.recordComplete).not.toHaveBeenCalled()
  })

  it("preserves typed unauthenticated results", async () => {
    const harness = createHarness()
    mocks.installService.resolveInstallSession.mockResolvedValueOnce({
      status: "unauthenticated",
    })
    mocks.installService.prepare.mockResolvedValueOnce({
      status: "unauthenticated",
    })

    await expect(harness.invoke("synapse:content-store-install:resolve", {
      sessionId: "session-1",
    })).resolves.toEqual({ status: "unauthenticated" })
    await expect(harness.invoke("synapse:content-store-install:prepare", {
      sessionId: "session-1",
    })).resolves.toEqual({ status: "unauthenticated" })
  })

  it("propagates service failures without returning temporary paths or raw bytes", async () => {
    const harness = createHarness()
    mocks.installService.prepare.mockRejectedValueOnce(new Error("package rejected"))

    await expect(harness.invoke("synapse:content-store-install:prepare", {
      sessionId: "session-1",
    })).rejects.toThrow("package rejected")

    mocks.installService.prepare.mockResolvedValueOnce({
      status: "prepared",
      source: {
        id: "prepared-1",
        contentId: "content-1",
        versionId: "version-1",
        type: "skill",
        title: "Store Skill",
        mainFile: "content/SKILL.md",
        mainContent: "# Store Skill\n",
        files: [],
        tempPath: "/tmp/secret",
      },
    })
    await expect(harness.invoke("synapse:content-store-install:prepare", {
      sessionId: "session-1",
    })).rejects.toThrow()
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  harness.registry.register(contentStoreInstallIpcModule, {
    moduleId: "content-store-install",
    resolve: <T,>(_serviceId: string): T => {
      throw new Error("content store install IPC should not resolve broad services")
    },
  })
  return harness
}
