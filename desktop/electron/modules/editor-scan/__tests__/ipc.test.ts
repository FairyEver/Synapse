import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  editorScanService: {
    finalizeQuickPublish: vi.fn(),
    scanAll: vi.fn(),
    trashScanItem: vi.fn(),
  },
}))

vi.mock("../../../services/editor-scan-service", () => ({
  scanAll: mocks.editorScanService.scanAll,
  readItemContent: vi.fn(),
  listSkillFiles: vi.fn(),
  finalizeQuickPublish: mocks.editorScanService.finalizeQuickPublish,
  prepareQuickPublishDraft: vi.fn(),
  trashScanItem: mocks.editorScanService.trashScanItem,
}))

import { editorScanIpcModule } from "../ipc"

describe("editorScanIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.editorScanService.finalizeQuickPublish.mockResolvedValue({
      status: "identity-written",
      message: "本地 Skill 已关联到已保存内容。",
    })
    mocks.editorScanService.trashScanItem.mockResolvedValue({ trashed: true, mode: "path", path: "/tmp/skills/review" })
  })

  it("rejects Skill removal through the legacy editor scan trash channel", async () => {
    const harness = createHarness()

    await expect(harness.invoke("synapse:app:editor_scan:operation:trash_item", {
      itemType: "skill",
      itemPath: "/tmp/skills/review",
      itemName: "review",
      editorId: "claude-code",
      scope: "global",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    })).rejects.toThrow()

    expect(mocks.editorScanService.trashScanItem).not.toHaveBeenCalled()
  })

  it("cancels an active scan by request id", async () => {
    const harness = createHarness()
    const requestId = "4ca12db4-dcf0-4bfd-905a-4bf65f63204f"
    let capturedSignal: AbortSignal | undefined
    mocks.editorScanService.scanAll.mockImplementationOnce((signal: AbortSignal) => {
      capturedSignal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Editor scan cancelled.")), { once: true })
      })
    })

    const scanResult = expect(harness.invoke("synapse:app:editor_scan:operation:scan_all", { requestId }))
      .rejects.toThrow("Editor scan cancelled.")
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())

    await expect(harness.invoke("synapse:app:editor_scan:operation:cancel_scan", { requestId }))
      .resolves.toEqual({ cancelled: true })
    expect(capturedSignal?.aborted).toBe(true)
    await scanResult
  })

  it("finalizes a checked Skill publish through the main process", async () => {
    const harness = createHarness()
    const request = {
      contentId: "skill-1",
      mode: "new" as const,
      repositoryVersion: "20260713010101",
      sessionId: "c5e23732-3f58-40c2-9d71-7ce5d0df07be",
    }

    await expect(harness.invoke("synapse:app:editor_scan:operation:finalize_quick_publish", request)).resolves.toEqual({
      status: "identity-written",
      message: "本地 Skill 已关联到已保存内容。",
    })
    expect(mocks.editorScanService.finalizeQuickPublish).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ actor: { kind: "user" } }),
    )
  })
})

function createHarness() {
  const auditSink = { record: vi.fn() }
  const permissionGuard = { check: vi.fn() }
  const harness = createInMemoryHarness()
  harness.registry.register(editorScanIpcModule, {
    moduleId: "editor-scan",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.audit-sink") return auditSink as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      throw new Error(`unexpected service ${serviceId}`)
    },
  })
  return harness
}
