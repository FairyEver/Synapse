import { describe, expect, it } from "vitest"
import {
  capabilityIdToIpcChannel,
  capabilityIdToMcpTool,
  capabilityIdToServiceMethod,
  ipcOperationIdToBridgePath,
  ipcOperationIdToChannel,
  getCapabilityAction,
  getCapabilityDomain,
  isCanonicalCapabilityId,
} from "../../synapse-capabilities/shared/naming"

describe("capability naming", () => {
  it("validates canonical ids", () => {
    expect(isCanonicalCapabilityId("app.database.table.list")).toBe(true)
    expect(isCanonicalCapabilityId("app.automation.trigger_type.list")).toBe(true)
    expect(isCanonicalCapabilityId("database.table.list")).toBe(false)
    expect(isCanonicalCapabilityId("database.table.fetch")).toBe(false)
    expect(isCanonicalCapabilityId("database.table")).toBe(false)
    expect(isCanonicalCapabilityId("database.Table.list")).toBe(false)
  })

  it("derives public names from canonical ids", () => {
    expect(capabilityIdToMcpTool("app.database.table.list")).toBe("app_database_table_list")
    expect(capabilityIdToServiceMethod("app.automation.runtime.inspect")).toBe("appAutomationRuntimeInspect")
  })

  it("derives canonical IPC and bridge names", () => {
    expect(capabilityIdToIpcChannel("app.database.table.list")).toBe("synapse:app:database:table:list")
    expect(ipcOperationIdToChannel("app.model_price.rule.clear")).toBe("synapse:app:model_price:rule:clear")
    expect(ipcOperationIdToBridgePath("app.resource_repository.skill.create")).toBe(
      "resourceRepository.skill.create",
    )
  })

  it("extracts domain and action tokens", () => {
    expect(getCapabilityDomain("app.database.sql.execute")).toBe("database")
    expect(getCapabilityAction("app.database.sql.execute")).toBe("execute")
  })
})
