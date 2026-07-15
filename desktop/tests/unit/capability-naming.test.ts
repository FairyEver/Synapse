import { describe, expect, it } from "vitest"
import {
  capabilityIdToMcpTool,
  capabilityIdToServiceMethod,
  getCapabilityAction,
  getCapabilityDomain,
  isCanonicalCapabilityId,
} from "../../synapse-capabilities/shared/naming"

describe("capability naming", () => {
  it("validates canonical ids", () => {
    expect(isCanonicalCapabilityId("database.table.list")).toBe(true)
    expect(isCanonicalCapabilityId("automation.trigger_type.list")).toBe(true)
    expect(isCanonicalCapabilityId("app.swarm_task.run.stop_refill")).toBe(true)
    expect(isCanonicalCapabilityId("database.table.fetch")).toBe(false)
    expect(isCanonicalCapabilityId("database.table")).toBe(false)
    expect(isCanonicalCapabilityId("database.Table.list")).toBe(false)
  })

  it("derives public names from canonical ids", () => {
    expect(capabilityIdToMcpTool("database.table.list")).toBe("database_table_list")
    expect(capabilityIdToServiceMethod("automation.runtime.inspect")).toBe("automationRuntimeInspect")
  })

  it("extracts domain and action tokens", () => {
    expect(getCapabilityDomain("database.sql.execute")).toBe("database")
    expect(getCapabilityAction("database.sql.execute")).toBe("execute")
  })
})
