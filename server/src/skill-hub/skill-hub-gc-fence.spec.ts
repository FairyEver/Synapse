import { describe, expect, it, vi } from "vitest"
import { runUnderHubGcFence } from "./skill-hub-gc-fence"

describe("Skill Hub GC fence", () => {
  it("does not run a GC job when another session holds the fence", async () => {
    const db = { connect: vi.fn(), end: vi.fn(), on: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [{ acquired: false }] }) }
    const job = vi.fn()
    await expect(runUnderHubGcFence(db, job, { waitMs: 0 })).resolves.toBeUndefined()
    expect(job).not.toHaveBeenCalled()
    expect(db.end).toHaveBeenCalledOnce()
  })

  it("holds the connection through dump and copy, releasing even on failure", async () => {
    const db = { connect: vi.fn(), end: vi.fn(), on: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) }
    await expect(runUnderHubGcFence(db, async (signal) => {
      expect(signal.aborted).toBe(false)
      expect(db.end).not.toHaveBeenCalled()
      throw new Error("copy failed")
    }, { waitMs: 0 })).rejects.toThrow("copy failed")
    expect(db.end).toHaveBeenCalledOnce()
  })
})
