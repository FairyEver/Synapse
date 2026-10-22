import { describe, expect, it } from "vitest"
import { isCanonicalCapabilityId } from "../naming"
import { WECOM_DOMAIN, buildWecomTools } from "../wecom-domain"

describe("Enterprise WeChat capability domain", () => {
  it("registers the connection and controlled CLI capabilities", () => {
    expect(WECOM_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "app.wecom.connection.get",
      "app.wecom.cli.run",
    ])
    for (const capability of WECOM_DOMAIN.capabilities) {
      expect(isCanonicalCapabilityId(capability.id), capability.id).toBe(true)
    }
    expect(WECOM_DOMAIN.capabilities.find((capability) => capability.id === "app.wecom.cli.run"))
      .toMatchObject({ mutates: true, risk: "high" })
  })

  it("publishes the connection and args-array command contract", () => {
    const tools = buildWecomTools()
    expect(tools.map((tool) => tool.name)).toEqual([
      "app_wecom_connection_get",
      "app_wecom_cli_run",
    ])
    expect(tools.find((tool) => tool.name === "app_wecom_connection_get")?.description)
      .toContain("never returns credentials")
    expect(tools.find((tool) => tool.name === "app_wecom_cli_run")?.inputSchema.required)
      .toContain("args")
    expect(tools.find((tool) => tool.name === "app_wecom_cli_run")?.inputSchema.properties.args)
      .toMatchObject({ type: "array", minItems: 1, maxItems: 256 })
  })
})
