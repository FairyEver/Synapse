import { describe, expect, it, vi } from "vitest"
import { knowledgeBaseIpcModule } from "../ipc"

vi.mock("electron", () => ({
  shell: { showItemInFolder: vi.fn() },
}))

function createContext(service: unknown) {
  const permissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn().mockResolvedValue({ allowed: true }),
  }
  const auditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  return {
    resolve: vi.fn((id: string) => {
      if (id === "knowledge-base.service") return service
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.audit-sink") return auditSink
      throw new Error(`Unknown service: ${id}`)
    }),
    permissionGuard,
    auditSink,
  }
}

describe("knowledgeBaseIpcModule", () => {
  it("initializes a knowledge base through the service", async () => {
    const initialize = vi.fn().mockResolvedValue({
      projectPath: "/tmp/kb",
      templateVersion: "2026-05-21",
      createdFiles: [".synapse-kb.json"],
      existingFiles: [],
    })
    const ctx = createContext({ initialize })

    const result = await knowledgeBaseIpcModule.methods.initialize.handler(ctx as never, {
      projectPath: "/tmp/kb",
      mode: "create",
    }) as { createdFiles: string[] }

    expect(initialize).toHaveBeenCalledWith({ projectPath: "/tmp/kb", mode: "create" })
    expect(result.createdFiles).toEqual([".synapse-kb.json"])
  })

  it("opens raw directory through the service", async () => {
    const openRawDirectory = vi.fn().mockResolvedValue({ rawPath: "/tmp/kb/.raw" })
    const ctx = createContext({ openRawDirectory })

    const result = await knowledgeBaseIpcModule.methods.openRawDirectory.handler(ctx as never, {
      projectPath: "/tmp/kb",
    }) as { rawPath: string }

    expect(openRawDirectory).toHaveBeenCalledWith("/tmp/kb")
    expect(result.rawPath).toBe("/tmp/kb/.raw")
  })
})
