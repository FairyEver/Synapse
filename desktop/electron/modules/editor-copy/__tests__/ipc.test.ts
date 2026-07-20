import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"

const mocks = vi.hoisted(() => ({
  editorCopyService: {
    copy: vi.fn(),
    resolveTarget: vi.fn(),
  },
  logger: {
    info: vi.fn(),
  },
}))

vi.mock("../../../services/editor-copy-service", () => ({
  editorCopyService: mocks.editorCopyService,
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

import { editorCopyIpcModule } from "../ipc"

describe("editorCopyIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.editorCopyService.copy.mockResolvedValue({ targetPath: "/tmp/target/AGENTS.md" })
    mocks.editorCopyService.resolveTarget.mockResolvedValue({ status: "ready", targetPath: "/tmp/target/AGENTS.md" })
  })

  it("logs copy requests without persisting the source path", async () => {
    const harness = createHarness()
    const sourcePath = "/Users/ada/private-project/.cursor/rules/review-rule.mdc"

    await expect(harness.invoke("synapse:app:editor_copy:operation:copy", {
      source: {
        editorId: "cursor",
        itemName: "review-rule",
        itemPath: sourcePath,
        itemType: "rule",
        scope: "project",
      },
      targetEditorId: "claude-code",
      targetProjectPath: "/Users/ada/target-project",
      targetScope: "project",
    })).resolves.toEqual({ targetPath: "/tmp/target/AGENTS.md" })

    expect(mocks.editorCopyService.copy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ itemPath: sourcePath }),
      }),
      expect.objectContaining({
        actor: { kind: "user" },
        auditSink: expect.objectContaining({ record: expect.any(Function) }),
        permissionGuard: expect.objectContaining({ check: expect.any(Function) }),
      }),
    )
    expect(mocks.logger.info).toHaveBeenCalledWith("Handling editor copy request.", {
      contentType: "rule",
      sourceEditorId: "cursor",
      sourceName: "review-rule.mdc",
      targetEditorId: "claude-code",
      targetScope: "project",
    })
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(sourcePath)
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain("private-project")
  })
})

function createHarness() {
  const auditSink = { record: vi.fn() }
  const permissionGuard = { check: vi.fn() }
  const harness = createInMemoryHarness()
  harness.registry.register(editorCopyIpcModule, {
    moduleId: "editor-copy",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.audit-sink") return auditSink as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      throw new Error(`unexpected service ${serviceId}`)
    },
  })
  return harness
}
