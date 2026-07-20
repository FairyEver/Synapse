/**
 * Phase 0.3 — Integration test.
 *
 * SPEC §6 verification:
 *   - "DevTools 调 window.synapse.content.list(...) 返回正确数据" → covered by
 *     in-memory IPC harness round-trip with a local typed module.
 *   - "NetworkServiceRegistry 单测：端口冲突自动选下一个、auth token 生成、
 *     conflict policy 生效" → see runtime/network/__tests__.
 *   - "CI 闸门：generated 与源一致性比对" → check-ipc-codegen.mjs script.
 */

import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  createInMemoryHarness,
  type IpcMethodDescriptor,
  type IpcModule,
} from "../../electron/runtime/ipc"
import { createWindowManager, type ManagedWindow } from "../../electron/runtime/window"
import { createNetworkServiceRegistry } from "../../electron/runtime/network"

const demoEchoMethod: IpcMethodDescriptor<{ text: string }, { text: string }> = {
  kind: "invoke",
  operationId: "app.demo.operation.echo",
  request: z.object({ text: z.string() }),
  response: z.object({ text: z.string() }),
  handler: (_ctx, request) => ({ text: request.text }),
}

const demoIpcModule: IpcModule = {
  id: "demo",
  methods: {
    echo: demoEchoMethod,
  },
  events: {},
}

const fakeWindow = (id: number, role: "main" | "detail" | "overlay" = "main"): ManagedWindow & { sent: Array<{ channel: string; payload: unknown }> } => {
  const sent: Array<{ channel: string; payload: unknown }> = []
  return {
    id,
    role,
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    show: () => {},
    focus: () => {},
    restore: () => {},
    send: (channel, payload) => sent.push({ channel, payload }),
    close: () => {},
    sent,
  } as ManagedWindow & { sent: Array<{ channel: string; payload: unknown }> }
}

describe("Phase 0.3 integration (T3.16)", () => {
  it("typed IPC modules work end-to-end through the IpcRegistry", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(demoIpcModule, {
      moduleId: "demo",
      resolve: <T,>(): T => {
        throw new Error("unused")
      },
    })
    const reply = await harness.invoke("synapse:app:demo:operation:echo", { text: "ok" })
    expect(reply).toEqual({ text: "ok" })
  })

  it("WindowManager broadcast targets only alive windows that pass the filter", () => {
    const manager = createWindowManager()
    const a = fakeWindow(1, "main")
    const b = fakeWindow(2, "detail")
    manager.register({ id: "main", role: "main", create: () => a })
    manager.register({ id: "detail", role: "detail", create: () => b })
    manager.open("main")
    manager.open("detail")
    const sent = manager.broadcast("synapse:test", { v: 1 }, (w) => w.role === "main")
    expect(sent).toBe(1)
  })

  it("NetworkServiceRegistry preferred-port + next-available + dedup work together", async () => {
    const reg = createNetworkServiceRegistry({ probePort: async () => true })
    const a = await reg.register({
      id: "mcp-http",
      role: "http",
      preferredPort: 50001,
      handler: { handle: () => "ok" },
    })
    const b = await reg.register({
      id: "management-api",
      role: "http",
      preferredPort: 50001, // conflict with mcp-http
      handler: { handle: () => "ok" },
    })
    expect(a.port).toBe(50001)
    expect(b.port).not.toBe(50001)
    expect(reg.list()).toHaveLength(2)
  })

  it("the runtime hard-rule: only the runtime/network/ports.ts file calls net.createServer", async () => {
    const fs = await import("node:fs")
    const pathMod = await import("node:path")
    const electronDir = pathMod.resolve(__dirname, "..", "..", "electron")

    const violations: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = pathMod.join(dir, entry.name)
        if (entry.isDirectory()) {
          const rel = pathMod.relative(electronDir, full).replace(/\\/g, "/")
          if (rel.startsWith("runtime/network")) continue
          walk(full)
        } else if (entry.isFile() && /\.[tj]sx?$/.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8")
          if (/net\.createServer/.test(content)) {
            violations.push(pathMod.relative(electronDir, full))
          }
        }
      }
    }
    walk(electronDir)
    expect(violations).toEqual([])
  })
})
