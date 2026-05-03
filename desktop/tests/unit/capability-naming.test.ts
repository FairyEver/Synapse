import { describe, expect, it } from "vitest"
import {
  capabilityIdToCliCommand,
  capabilityIdToMcpTool,
  capabilityIdToServiceMethod,
  getCapabilityAction,
  getCapabilityDomain,
  isCanonicalCapabilityId,
} from "../../synapse-capabilities/shared/naming"

describe("capability naming", () => {
  it("validates canonical ids", () => {
    expect(isCanonicalCapabilityId("database.table.list")).toBe(true)
    expect(isCanonicalCapabilityId("scheduler.action_type.list")).toBe(true)
    expect(isCanonicalCapabilityId("database.table.fetch")).toBe(false)
    expect(isCanonicalCapabilityId("database.table")).toBe(false)
    expect(isCanonicalCapabilityId("database.Table.list")).toBe(false)
  })

  it("derives public names from canonical ids", () => {
    expect(capabilityIdToMcpTool("database.table.list")).toBe("database_table_list")
    expect(capabilityIdToCliCommand("database.choice_usage.get")).toBe("database choice-usage get")
    expect(capabilityIdToServiceMethod("scheduler.runtime.inspect")).toBe("schedulerRuntimeInspect")
  })

  it("extracts domain and action tokens", () => {
    expect(getCapabilityDomain("database.sql.execute")).toBe("database")
    expect(getCapabilityAction("database.sql.execute")).toBe("execute")
  })
})
