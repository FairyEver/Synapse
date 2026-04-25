/**
 * Phase 0.3 — Integration test.
 *
 * SPEC §6 verification:
 *   - "DevTools 调 window.synapse.content.list(...) 返回正确数据" → covered by
 *     in-memory IPC harness round-trip via synapse:system:handshake (the only
 *     migrated module so far; full coverage lands when T3.4-T3.10 follow-up
 *     PR migrates real handlers).
 *   - "NetworkServiceRegistry 单测：端口冲突自动选下一个、auth token 生成、
 *     conflict policy 生效" → see runtime/network/__tests__.
 *   - "CI 闸门：generated 与源一致性比对" → check-ipc-codegen.mjs script.
 */

import { describe, expect, it } from "vitest"
import {
  IPC_PROTOCOL_VERSION,
  createInMemoryHarness,
  systemIpcModule,
} from "../../electron/runtime/ipc"
import { createWindowManager, type ManagedWindow } from "../../electron/runtime/window"
import { createNetworkServiceRegistry } from "../../electron/runtime/network"

const ctx = {
  moduleId: "system",
  resolve: <T,>(): T => {
    throw new Error("unused")
  },
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
  it("system handshake works end-to-end through the IpcRegistry", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(systemIpcModule, ctx)
    const reply = await harness.invoke("synapse:system:handshake", {
      clientVersion: IPC_PROTOCOL_VERSION,
    })
    expect(reply).toEqual({ ok: true, serverVersion: IPC_PROTOCOL_VERSION })
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
    const { execSync } = await import("node:child_process")
    const pathMod = await import("node:path")
    const cwd = pathMod.resolve(__dirname, "..", "..")
    const result = execSync(
      `rg -l "net\\\\.createServer" electron/ --glob '!electron/runtime/network/**' || true`,
      { cwd, encoding: "utf8" },
    )
    expect(result.trim()).toBe("")
  })
})
