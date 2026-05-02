import { describe, expect, it } from "vitest"

import { DATA_STORE_DOMAIN } from "../../data-store/shared/capability-registry"

describe("Synapse capability domains", () => {
  it("keeps Data Store capabilities in the Data Store domain", () => {
    expect(DATA_STORE_DOMAIN.id).toBe("data-store")
    expect(DATA_STORE_DOMAIN.capabilities.map((capability) => capability.action)).toContain("listTables")
    expect(DATA_STORE_DOMAIN.capabilities.map((capability) => capability.mcpTool)).toContain("list_tables")
    expect(DATA_STORE_DOMAIN.capabilities.some((capability) => capability.action.startsWith("scheduler"))).toBe(false)
  })
})
