import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NodeTypeRegistry } from "../registry"
import { z } from "zod"
import { Square } from "lucide-react"
import type { NodeManifest, NodeExecutor } from "../types"

const stub: NodeManifest<{ t: string }> = {
  type: "stub", title: "Stub", icon: Square, color: "bg-muted",
  defaultConfig: { t: "" },
  ports: { inputs: [{ id: "in", label: "In" }], outputs: [{ id: "out", label: "Out" }] },
  cardSummary: (c) => ({ title: c.t, subtitle: "" }),
  configFields: [],
  configSchema: z.object({ t: z.string() }),
}
const exec: NodeExecutor<{ t: string }> = { execute: async () => ({ status: "success", output: "ok", durationMs: 0 }) }

describe("NodeTypeRegistry", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock("electron")
    vi.doUnmock("../../electron/services/log-store")
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.doUnmock("electron")
    vi.doUnmock("../../electron/services/log-store")
  })

  it("registers and retrieves manifest and executor", () => {
    const r = new NodeTypeRegistry()
    r.register(stub, exec)
    expect(r.getManifest("stub")).toBe(stub)
    expect(r.getExecutor("stub")).toBe(exec)
    expect(r.listTypes()).toEqual(["stub"])
  })
  it("throws for unknown type", () => {
    expect(() => new NodeTypeRegistry().getManifest("nope")).toThrow("Unknown node type: nope")
  })

  it("registers codex manifest in renderer registry", async () => {
    await import("../register.renderer")
    const { nodeTypeRegistry } = await import("../registry")

    const manifest = nodeTypeRegistry.getManifest("codex")

    expect(manifest.title).toBe("Codex")
    expect(manifest.type).toBe("codex")
  })

  it("registers codex manifest and executor in main registry", async () => {
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp",
        getAppPath: () => "/tmp",
      },
    }))

    vi.doMock("../../electron/services/log-store", () => ({
      createMainLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    await import("../register.main")
    const [{ nodeTypeRegistry }, { codexNodeExecutor }] = await Promise.all([
      import("../registry"),
      import("../codex/executor.main"),
    ])

    expect(nodeTypeRegistry.getManifest("codex").title).toBe("Codex")
    expect(nodeTypeRegistry.getExecutor("codex")).toBe(codexNodeExecutor)
  })

  it("registers claude code manifest in renderer registry", async () => {
    await import("../register.renderer")
    const { nodeTypeRegistry } = await import("../registry")

    const manifest = nodeTypeRegistry.getManifest("claude_code")

    expect(manifest.title).toBe("Claude Code")
    expect(manifest.type).toBe("claude_code")
  })

  it("registers document template manifest in renderer registry", async () => {
    await import("../register.renderer")
    const { nodeTypeRegistry } = await import("../registry")

    const manifest = nodeTypeRegistry.getManifest("document_template_docx_generate")

    expect(manifest.title).toBe("生成 Word 文档")
    expect(manifest.type).toBe("document_template_docx_generate")
  })

  it("registers claude code manifest and executor in main registry", async () => {
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp",
        getAppPath: () => "/tmp",
      },
    }))

    vi.doMock("../../electron/services/log-store", () => ({
      createMainLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    await import("../register.main")
    const [{ nodeTypeRegistry }, { claudeCodeNodeExecutor }] = await Promise.all([
      import("../registry"),
      import("../claude-code/executor.main"),
    ])

    expect(nodeTypeRegistry.getManifest("claude_code").title).toBe("Claude Code")
    expect(nodeTypeRegistry.getExecutor("claude_code")).toBe(claudeCodeNodeExecutor)
  })

  it("registers document template manifest and executor in main registry", async () => {
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp",
        getAppPath: () => "/tmp",
      },
    }))

    vi.doMock("../../electron/services/log-store", () => ({
      createMainLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    await import("../register.main")
    const [{ nodeTypeRegistry }, { documentTemplateNodeExecutor }] = await Promise.all([
      import("../registry"),
      import("../../app-capabilities/document-template/workflow-node/executor.main"),
    ])

    expect(nodeTypeRegistry.getManifest("document_template_docx_generate").title).toBe("生成 Word 文档")
    expect(nodeTypeRegistry.getExecutor("document_template_docx_generate")).toBe(documentTemplateNodeExecutor)
  })
})
