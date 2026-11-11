import { describe, expect, it } from "vitest"
import { TunnelBudget } from "./tunnel-budget"
describe("tunnel concurrent stream budget", () => {
  it("enforces the actual 16/64/256 defaults", () => {
    const budget = new TunnelBudget()
    const leases = Array.from({ length: 256 }, (_, i) => budget.acquire({ userId: `u${Math.floor(i / 64)}`, mappingId: `m${Math.floor(i / 16)}` }))
    expect(() => budget.acquire({ userId: "new", mappingId: "new" })).toThrow()
    leases.forEach(lease => lease.release())
    expect(budget.size).toBe(0)
  })
  it("enforces mapping, owner and global limits and releases exactly once", () => {
    const budget = new TunnelBudget({ mapping: 1, user: 2, global: 3 })
    const a = budget.acquire({ userId: "u1", mappingId: "m1" })
    expect(() => budget.acquire({ userId: "u1", mappingId: "m1" })).toThrow()
    const b = budget.acquire({ userId: "u1", mappingId: "m2" })
    expect(() => budget.acquire({ userId: "u1", mappingId: "m3" })).toThrow()
    const c = budget.acquire({ userId: "u2", mappingId: "m3" })
    expect(() => budget.acquire({ userId: "u3", mappingId: "m4" })).toThrow()
    a.release(); a.release(); b.release(); c.release()
    expect(budget.size).toBe(0)
  })
})
