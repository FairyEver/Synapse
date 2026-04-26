import { describe, expect, it } from "vitest"
import { ConnectorRegistryService } from "../../electron/services/connector-registry-service"

describe("connector registry", () => {
  it("exposes only Feishu and Lark built-in platform descriptors", () => {
    const registry = new ConnectorRegistryService()
    const types = registry.listDescriptors().map((descriptor) => descriptor.type)

    expect(types).toEqual(["feishu", "lark"])
    expect(registry.getDescriptor("feishu")?.capabilities).toEqual(expect.arrayContaining([
      "card.out",
      "button.out",
      "progress.card",
    ]))
    expect(registry.getDescriptor("lark")?.options.map((option) => option.name)).toEqual(expect.arrayContaining([
      "app_id",
      "app_secret",
      "domain",
      "group_reply_all",
      "thread_isolation",
    ]))
  })

  it("keeps raw platform secrets out of connector JSON", () => {
    const registry = new ConnectorRegistryService()
    const draft = registry.createConnectorDraft({
      type: "feishu",
      name: "workspace-a",
      options: {
        app_id: "cli_123",
        app_secret: "sec_hidden",
        allow_from: "U1,U2",
      },
    })

    expect(draft.connector).toMatchObject({
      id: "connector:feishu:workspace-a",
      type: "feishu",
      status: "configured",
      allowFrom: "U1,U2",
      secretRefs: {
        app_secret: "connector:feishu:workspace-a:app-secret",
      },
    })
    expect(draft.secrets.map((secret) => secret.value)).toEqual(["sec_hidden"])
    expect(JSON.stringify(draft.connector)).not.toContain("sec_hidden")
  })

  it("rejects non Feishu/Lark platform drafts as unsupported legacy types", () => {
    const registry = new ConnectorRegistryService()
    const draft = registry.createConnectorDraft({
      type: "telegram",
      options: { allow_from: "123" },
    })

    expect(draft.connector.status).toBe("invalid")
    expect(draft.issues).toEqual([{
      code: "unknown_connector_type",
      message: "unknown connector type \"telegram\"",
    }])
  })

  it("preserves disabled connector state and warns on open allow_from", () => {
    const registry = new ConnectorRegistryService()
    const draft = registry.createConnectorDraft({
      type: "lark",
      enabled: false,
      options: {
        app_id: "cli_lark",
        app_secret: "sec_lark",
      },
    })

    expect(draft.connector.status).toBe("disabled")
    expect(draft.connector.options.allow_from).toBe("*")
    expect(draft.warnings).toEqual(["allow_from is open to all users"])
  })

  it("allows later modules to register connector descriptors without hardcoded enums", () => {
    const registry = new ConnectorRegistryService()
    registry.register({
      type: "local-test",
      label: "Local Test",
      transport: "memory",
      options: [{ name: "endpoint", kind: "string", required: true }],
      capabilities: ["text.in"],
    })

    const draft = registry.createConnectorDraft({
      type: "local-test",
      options: { endpoint: "memory://inbox" },
    })

    expect(registry.getDescriptor("local-test")?.transport).toBe("memory")
    expect(draft.connector.status).toBe("configured")
    expect(draft.connector.capabilities).toEqual(["text.in"])
  })
})
