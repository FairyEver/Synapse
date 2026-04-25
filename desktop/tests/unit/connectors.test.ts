import { describe, expect, it } from "vitest"
import { ConnectorRegistryService } from "../../electron/services/connector-registry-service"

describe("connector registry", () => {
  it("registers CC Connect platform descriptors and capability map", () => {
    const registry = new ConnectorRegistryService()
    const types = registry.listDescriptors().map((descriptor) => descriptor.type)

    expect(types).toEqual([
      "dingtalk",
      "discord",
      "feishu",
      "lark",
      "line",
      "qq",
      "qqbot",
      "slack",
      "telegram",
      "wecom",
      "weibo",
      "weixin",
    ])

    expect(registry.getDescriptor("telegram")?.capabilities).toEqual(expect.arrayContaining([
      "image.in",
      "file.out",
      "reply-context.reconstruct",
    ]))
    expect(registry.getDescriptor("feishu")?.capabilities).toEqual(expect.arrayContaining([
      "card.out",
      "button.out",
      "progress.card",
    ]))
    expect(registry.getDescriptor("wecom")?.capabilities).toEqual(expect.arrayContaining([
      "audio.in",
      "async.recover",
    ]))
  })

  it("keeps raw platform secrets out of connector JSON", () => {
    const registry = new ConnectorRegistryService()
    const draft = registry.createConnectorDraft({
      type: "slack",
      name: "workspace-a",
      options: {
        bot_token: "xoxb-secret",
        app_token: "xapp-secret",
        allow_from: "U1,U2",
      },
    })

    expect(draft.connector).toMatchObject({
      id: "connector:slack:workspace-a",
      type: "slack",
      status: "configured",
      allowFrom: "U1,U2",
      secretRefs: {
        bot_token: "connector:slack:workspace-a:bot-token",
        app_token: "connector:slack:workspace-a:app-token",
      },
    })
    expect(draft.secrets.map((secret) => secret.value)).toEqual(["xoxb-secret", "xapp-secret"])
    expect(JSON.stringify(draft.connector)).not.toContain("xoxb-secret")
    expect(JSON.stringify(draft.connector)).not.toContain("xapp-secret")
  })

  it("marks missing required credentials invalid without attempting real platform connections", () => {
    const registry = new ConnectorRegistryService()
    const draft = registry.createConnectorDraft({
      type: "telegram",
      options: { allow_from: "123" },
    })

    expect(draft.connector.status).toBe("invalid")
    expect(draft.issues).toEqual([{
      code: "missing_required_option",
      option: "token",
      message: "telegram.token is required",
    }])
  })

  it("preserves disabled connector state and warns on open allow_from", () => {
    const registry = new ConnectorRegistryService()
    const draft = registry.createConnectorDraft({
      type: "line",
      enabled: false,
      options: {
        channel_secret: "secret",
        channel_token: "token",
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
