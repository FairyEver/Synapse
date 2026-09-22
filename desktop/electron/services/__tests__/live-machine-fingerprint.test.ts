import { describe, expect, it, vi } from "vitest"
import { createMachineFingerprintReader } from "../live-machine-fingerprint"

vi.mock("../log-store", () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))

const uuid = "12345678-1234-5678-9abc-123456789abc"
function success(stdout: string) {
  return { stdout, exitCode: 0, signal: null, timedOut: false, durationMs: 1 }
}

describe("machine fingerprint", () => {
  it.each(["darwin", "win32"] as const)("reads %s using a bounded, audited process and caches the digest", async (platform) => {
    const run = vi.fn().mockResolvedValue(success(platform === "darwin" ? `"IOPlatformUUID" = "${uuid.toUpperCase()}"` : `\r\n${uuid}\r\n`))
    const read = createMachineFingerprintReader({ run }, platform, "D:\\Windows")
    const [first, second] = await Promise.all([read(), read()])
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toContain(uuid)
    expect(first).toBe(second)
    expect(await read()).toBe(first)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec", actor: { kind: "system", id: "live-machine-identity" }, timeoutMs: 5_000,
      command: platform === "darwin" ? "/usr/sbin/ioreg" : "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    }))
  })

  it.each(["", "00000000-0000-0000-0000-000000000000", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "not-a-uuid"])("rejects unusable hardware identifiers: %s", async (value) => {
    const run = vi.fn().mockResolvedValue(success(value))
    expect(await createMachineFingerprintReader({ run }, "win32")()).toBeNull()
  })

  it("retries after timeout or process failure without caching a false identity", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ ...success(uuid), timedOut: true })
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(success(uuid))
    const read = createMachineFingerprintReader({ run }, "win32")
    expect(await read()).toBeNull()
    expect(await read()).toBeNull()
    expect(await read()).toMatch(/^[0-9a-f]{64}$/)
  })

  it("does not run an OS command on unsupported platforms", async () => {
    const run = vi.fn()
    expect(await createMachineFingerprintReader({ run }, "linux")()).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
})
