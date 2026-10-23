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

  it("describes messaging and its upload dependency without advertising removed business services", () => {
    const tool = buildWecomTools().find((entry) => entry.name === "app_wecom_cli_run")!

    expect(tool.description).toContain("企业微信消息")
    expect(tool.description).toContain("media upload")
    expect(tool.description).not.toMatch(/企业微信邮件|文档搜索|在线表格|智能表格|通讯录/u)
    const args = tool.inputSchema.properties.args as { description: string }
    expect(args.description).toContain("message, media, identity, schema")
    expect(args.description).toContain("only upload")
  })
})
