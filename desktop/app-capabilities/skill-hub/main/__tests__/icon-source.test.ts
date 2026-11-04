import { describe, expect, it, vi } from "vitest"
import { normalizeHubIcon } from "../icon-source"

vi.mock("electron", () => ({ nativeImage: { createFromBuffer: vi.fn() } }))

describe("Skill Hub local icon normalization", () => {
  it("rejects oversized dimensions before calling the native decoder and rejects failed decoding", () => {
    const icon = Buffer.alloc(24)
    Buffer.from("89504e470d0a1a0a", "hex").copy(icon)
    icon.write("IHDR", 12)
    icon.writeUInt32BE(40_000, 16)
    icon.writeUInt32BE(40_000, 20)
    const decode = vi.fn(() => ({ isEmpty: () => true }))
    expect(() => normalizeHubIcon(icon, decode as never)).toThrow()
    expect(decode).not.toHaveBeenCalled()
    icon.writeUInt32BE(256, 16)
    icon.writeUInt32BE(256, 20)
    expect(() => normalizeHubIcon(icon, decode as never)).toThrow()
    expect(decode).toHaveBeenCalledOnce()
  })
})
