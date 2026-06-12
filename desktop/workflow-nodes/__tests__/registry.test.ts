import { describe, expect, it, vi } from "vitest"
import { NodeTypeRegistry } from "../registry"
import { z } from "zod"
import { Square } from "lucide-react"
import type { NodeManifest, NodeExecutor } from "../types"

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp",
    getAppPath: () => "/tmp",
  },
}))

vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

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
    vi.resetModules()

    await import("../register.renderer")
    const { nodeTypeRegistry } = await import("../registry")

    const manifest = nodeTypeRegistry.getManifest("codex")

    expect(manifest.title).toBe("Codex")
    expect(manifest.type).toBe("codex")
  })

  it("registers codex manifest and executor in main registry", async () => {
    vi.resetModules()

    await import("../register.main")
    const [{ nodeTypeRegistry }, { codexNodeExecutor }] = await Promise.all([
      import("../registry"),
      import("../codex/executor.main"),
    ])

    expect(nodeTypeRegistry.getManifest("codex").title).toBe("Codex")
    expect(nodeTypeRegistry.getExecutor("codex")).toBe(codexNodeExecutor)
  })
})
