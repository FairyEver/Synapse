import { describe, expect, it } from "vitest"
import { cloudTableConfig } from "./cloud-table-config"
describe("cloud-table execution configuration", () => {
  it("uses the agreed budgets and rejects invalid isolation settings", () => {
    expect(cloudTableConfig({})).toMatchObject({ concurrency: 8, ownerConcurrency: 2, authConcurrency: 4, ownerQueue: 32, globalQueue: 128, bytes: 16777216, waitMs: 5000, sqlMs: 2000, lockMs: 250 })
    expect(() => cloudTableConfig({ CLOUD_TABLE_INSTANCES: 2 })).toThrow()
    expect(() => cloudTableConfig({ CLOUD_TABLE_CONCURRENCY: 1, CLOUD_TABLE_OWNER_CONCURRENCY: 2 })).toThrow()
    expect(() => cloudTableConfig({ CLOUD_TABLE_SQL_MS: 0 })).toThrow()
  })
})
