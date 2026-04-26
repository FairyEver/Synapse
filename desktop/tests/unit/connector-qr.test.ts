import { describe, expect, it } from "vitest"
import { createDefaultConfig } from "../../src/lib/config"
import { summarizeCcConnectProjects } from "../../src/modules/connectors/project-model"
import {
  ConnectorQrOnboardingService,
  type ConnectorQrHttpClient,
  resolveFeishuSetupInputs,
  resolveWeixinSetupMode,
} from "../../electron/services/connector-qr-onboarding-service"
import { ConnectorRegistryService } from "../../electron/services/connector-registry-service"
import type { ConnectorSecretStoreService } from "../../electron/services/connector-secret-store-service"
import type { SynapseConfig } from "../../src/types/config"

function createMockHttpClient(responses: Array<{ status?: number; body: Record<string, unknown> }>) {
  const requests: Array<{ method: string; url: string; body?: string; headers?: Record<string, string> }> = []
  const client: ConnectorQrHttpClient = async (request) => {
    requests.push({
      method: request.method,
      url: request.url,
      body: request.body,
      headers: request.headers,
    })
    const response = responses.shift()
    if (!response) {
      throw new Error("missing mock response")
    }
    return {
      status: response.status ?? 200,
      body: JSON.stringify(response.body),
    }
  }

  return { client, requests }
}

function createSaveHarness() {
  let config: SynapseConfig = createDefaultConfig()
  config = {
    ...config,
    global: {
      ...config.global,
      projects: [{
        id: "project-1",
        name: "synapse",
        path: "/repo/synapse",
        workDir: "/repo/synapse",
        agentType: "codex",
        platformConnections: [],
      }],
    },
  }
  const secrets: Array<{ id: string; value: string }> = []
  const secretStore = {
    writeConnectorSecrets: async (items: Array<{ id: string; value: string }>) => {
      secrets.push(...items.map((item) => ({ id: item.id, value: item.value })))
    },
  } as unknown as ConnectorSecretStoreService

  return {
    get config() {
      return config
    },
    secrets,
    options: {
      config: {
        load: async () => structuredClone(config),
        update: async (patch: { global: { projects: SynapseConfig["global"]["projects"] } }) => {
          config = {
            ...config,
            global: {
              ...config.global,
              projects: patch.global.projects,
            },
          }
          return structuredClone(config)
        },
      },
      registry: new ConnectorRegistryService(),
      secretStore,
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    },
  }
}

describe("connector QR onboarding service", () => {
  it("resolves Feishu setup modes like the CC CLI", () => {
    expect(resolveFeishuSetupInputs("auto", "", "", "")).toEqual({
      mode: "new",
      appId: null,
      appSecret: null,
      error: null,
    })
    expect(resolveFeishuSetupInputs("auto", "cli_xxx:sec:yyy", "", "")).toEqual({
      mode: "bind",
      appId: "cli_xxx",
      appSecret: "sec:yyy",
      error: null,
    })
    expect(resolveFeishuSetupInputs("bind", "", "", "").error).toContain("bind mode requires credentials")
    expect(resolveFeishuSetupInputs("auto", "cli:sec", "cli", "sec").error).toBe("use either --app or --app-id/--app-secret, not both")
  })

  it("tracks Feishu QR registration pending, slow_down, lark switch, and success", () => {
    const service = new ConnectorQrOnboardingService()
    const session = service.beginFeishuRegistration({
      supportedAuthMethods: ["client_secret"],
    }, {
      deviceCode: "device-1",
      verificationUriComplete: "https://qr.example.test",
      interval: 2,
      expireIn: 60,
    }, {
      timeoutSeconds: 30,
      now: new Date("2026-04-26T00:40:00.000Z"),
    })

    expect(session).toMatchObject({
      platform: "feishu",
      status: "waiting",
      deviceCode: "device-1",
      qrContent: "https://qr.example.test",
      intervalSeconds: 2,
      expiresAt: "2026-04-26T00:40:30.000Z",
    })

    const slowed = service.pollFeishuRegistration(session, { error: "slow_down" })
    expect(slowed.intervalSeconds).toBe(7)

    expect(service.pollFeishuRegistration(slowed, {
      tenantBrand: "lark",
      clientId: "cli_lark",
      clientSecret: "sec_lark",
      ownerOpenId: "ou_owner",
    })).toMatchObject({
      platform: "lark",
      status: "success",
      result: {
        appId: "cli_lark",
        appSecret: "sec_lark",
        ownerOpenId: "ou_owner",
      },
    })
  })

  it("begins Feishu QR onboarding with a real registration begin response", async () => {
    const { client, requests } = createMockHttpClient([
      { body: { supported_auth_methods: ["client_secret"] } },
      { body: { device_code: "device-1", verification_uri_complete: "https://qr.example.test", interval: 3, expire_in: 90 } },
    ])
    const service = new ConnectorQrOnboardingService({ httpClient: client })

    const session = await service.beginQr("feishu")

    expect(session).toMatchObject({
      platform: "feishu",
      status: "waiting",
      qrContent: "https://qr.example.test",
      intervalSeconds: 3,
    })
    expect(requests.map((request) => request.body)).toEqual([
      "action=init",
      "action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id",
    ])
  })

  it("stops Feishu begin when init does not support client_secret", async () => {
    const { client, requests } = createMockHttpClient([
      { body: { supported_auth_methods: ["private_key"] } },
    ])
    const service = new ConnectorQrOnboardingService({ httpClient: client })

    const session = await service.beginQr("feishu")

    expect(session).toMatchObject({
      status: "failed",
      error: "current environment does not support client_secret auth",
    })
    expect(requests).toHaveLength(1)
  })

  it("maps Feishu slow_down, denied, and expired poll states", async () => {
    const { client } = createMockHttpClient([
      { body: { supported_auth_methods: ["client_secret"] } },
      { body: { device_code: "device-1", verification_uri_complete: "https://qr.example.test", interval: 2, expire_in: 90 } },
      { body: { error: "slow_down" } },
      { body: { error: "access_denied" } },
    ])
    const service = new ConnectorQrOnboardingService({ httpClient: client })
    const session = await service.beginQr("feishu")

    const slowed = await service.pollQr(session.sessionId)
    expect(slowed).toMatchObject({
      status: "waiting",
      intervalSeconds: 7,
    })
    const denied = await service.pollQr(session.sessionId)
    expect(denied).toMatchObject({
      status: "denied",
      error: "authorization denied by user",
    })

    const expiredService = new ConnectorQrOnboardingService({
      httpClient: createMockHttpClient([
        { body: { supported_auth_methods: ["client_secret"] } },
        { body: { device_code: "device-2", verification_uri_complete: "https://qr.example.test/2" } },
        { body: { error: "expired_token" } },
      ]).client,
    })
    const expiring = await expiredService.beginQr("feishu")
    expect(await expiredService.pollQr(expiring.sessionId)).toMatchObject({
      status: "expired",
      error: "onboarding session expired",
    })
  })

  it("returns a failed QR session when polling transport fails", async () => {
    const { client } = createMockHttpClient([
      { body: { supported_auth_methods: ["client_secret"] } },
      { body: { device_code: "device-1", verification_uri_complete: "https://qr.example.test" } },
    ])
    const service = new ConnectorQrOnboardingService({ httpClient: client })
    const session = await service.beginQr("feishu")

    expect(await service.pollQr(session.sessionId)).toMatchObject({
      status: "failed",
      error: "missing mock response",
    })
  })

  it("switches Feishu polling to Lark and hides app_secret from renderer state", async () => {
    const { client, requests } = createMockHttpClient([
      { body: { supported_auth_methods: ["client_secret"] } },
      { body: { device_code: "device-1", verification_uri_complete: "https://qr.example.test" } },
      { body: { error: "authorization_pending", user_info: { tenant_brand: "lark" } } },
      { body: { client_id: "cli_lark", client_secret: "sec_lark", user_info: { tenant_brand: "lark", open_id: "ou_owner" } } },
    ])
    const service = new ConnectorQrOnboardingService({ httpClient: client })
    const session = await service.beginQr("feishu")

    const completed = await service.pollQr(session.sessionId)

    expect(completed).toMatchObject({
      platform: "lark",
      status: "success",
      result: {
        appId: "cli_lark",
        ownerOpenId: "ou_owner",
      },
    })
    expect(JSON.stringify(completed)).not.toContain("sec_lark")
    expect(requests[3]?.url).toContain("accounts.larksuite.com")
  })

  it("saves Feishu app_secret into secret refs and shows configured platform", async () => {
    const harness = createSaveHarness()
    const { client } = createMockHttpClient([
      { body: { supported_auth_methods: ["client_secret"] } },
      { body: { device_code: "device-1", verification_uri_complete: "https://qr.example.test" } },
      { body: { client_id: "cli_123", client_secret: "sec_hidden", user_info: { open_id: "ou_owner" } } },
    ])
    const service = new ConnectorQrOnboardingService({
      ...harness.options,
      httpClient: client,
    })
    const session = await service.beginQr("feishu")
    await service.pollQr(session.sessionId)

    const result = await service.saveCompletedQr({ sessionId: session.sessionId, projectId: "project-1" })

    expect(result.connection).toMatchObject({
      type: "feishu",
      status: "configured",
      enabled: true,
      options: {
        app_id: "cli_123",
        owner_open_id: "ou_owner",
      },
      secretRefs: {
        app_secret: "connector:feishu:synapse-feishu:app-secret",
      },
    })
    expect(harness.secrets).toEqual([{
      id: "connector:feishu:synapse-feishu:app-secret",
      value: "sec_hidden",
    }])
    expect(JSON.stringify(harness.config.global.projects)).not.toContain("sec_hidden")
    expect(summarizeCcConnectProjects(harness.config.global.projects)[0]?.platforms[0]).toMatchObject({
      type: "feishu",
      status: "configured",
    })
  })

  it("resolves Weixin bind/new modes and QR states", () => {
    expect(resolveWeixinSetupMode("auto", "")).toEqual({ mode: "new", error: null })
    expect(resolveWeixinSetupMode("auto", "token")).toEqual({ mode: "bind", error: null })
    expect(resolveWeixinSetupMode("new", "token").error).toContain("new/QR mode does not accept --token")

    const service = new ConnectorQrOnboardingService()
    const session = service.beginWeixinQr({
      qrCode: "qr-key",
      qrCodeImageContent: "https://weixin.example.test/qr",
    })

    expect(session).toMatchObject({
      platform: "weixin",
      status: "waiting",
      deviceCode: "qr-key",
      qrContent: "https://weixin.example.test/qr",
      refreshCount: 1,
    })
    expect(service.pollWeixinQr(session, { status: "scaned" }).status).toBe("scanned")
    expect(service.pollWeixinQr(session, { status: "expired" })).toMatchObject({
      status: "expired",
      refreshCount: 2,
      error: "qrcode expired",
    })
    expect(service.pollWeixinQr(session, {
      status: "confirmed",
      botToken: "bot-token",
      ilinkBotId: "bot-id",
      baseUrl: "https://ilink.example.test",
      ilinkUserId: "wx-user",
    })).toMatchObject({
      status: "success",
      result: {
        botToken: "bot-token",
        ilinkBotId: "bot-id",
        baseUrl: "https://ilink.example.test",
        ilinkUserId: "wx-user",
      },
    })
  })

  it("begins and polls Weixin QR onboarding through ilink", async () => {
    const { client, requests } = createMockHttpClient([
      { body: { qrcode: "qr-key", qrcode_img_content: "https://weixin.example.test/qr" } },
      { body: { status: "wait" } },
      { body: { status: "scaned" } },
      { body: { status: "expired" } },
    ])
    const service = new ConnectorQrOnboardingService({ httpClient: client })
    const session = await service.beginQr("weixin")

    expect(session).toMatchObject({
      platform: "weixin",
      status: "waiting",
      qrContent: "https://weixin.example.test/qr",
    })
    expect(requests[0]?.url).toContain("/ilink/bot/get_bot_qrcode?bot_type=3")
    expect(await service.pollQr(session.sessionId)).toMatchObject({ status: "waiting" })
    expect(await service.pollQr(session.sessionId)).toMatchObject({ status: "scanned" })
    expect(requests[2]?.headers).toMatchObject({ "iLink-App-ClientVersion": "1" })
    expect(await service.pollQr(session.sessionId)).toMatchObject({ status: "expired" })
  })

  it("rejects Weixin confirmed responses without bot_token or ilink_bot_id", () => {
    const service = new ConnectorQrOnboardingService()
    const session = service.beginWeixinQr({
      qrCode: "qr-key",
      qrCodeImageContent: "https://weixin.example.test/qr",
    })

    expect(service.pollWeixinQr(session, { status: "confirmed", botToken: "bot-token" })).toMatchObject({
      status: "failed",
      error: "login confirmed but ilink_bot_id missing",
    })
    expect(service.pollWeixinQr(session, { status: "confirmed", ilinkBotId: "bot-id" })).toMatchObject({
      status: "failed",
      error: "login confirmed but bot_token missing",
    })
  })

  it("saves Weixin token into secret refs only", async () => {
    const harness = createSaveHarness()
    const { client } = createMockHttpClient([
      { body: { qrcode: "qr-key", qrcode_img_content: "https://weixin.example.test/qr" } },
      { body: { status: "confirmed", bot_token: "wx-token-hidden", ilink_bot_id: "bot-id", baseurl: "https://ilink.example.test", ilink_user_id: "wx-user" } },
    ])
    const service = new ConnectorQrOnboardingService({
      ...harness.options,
      httpClient: client,
    })
    const session = await service.beginQr("weixin")
    const completed = await service.pollQr(session.sessionId)

    expect(JSON.stringify(completed)).not.toContain("wx-token-hidden")
    const result = await service.saveCompletedQr({ sessionId: session.sessionId, projectId: "project-1" })

    expect(result.connection).toMatchObject({
      type: "weixin",
      status: "configured",
      options: {
        base_url: "https://ilink.example.test",
        account_id: "bot-id",
        ilink_user_id: "wx-user",
      },
      secretRefs: {
        token: "connector:weixin:synapse-weixin:token",
      },
    })
    expect(harness.secrets).toEqual([{
      id: "connector:weixin:synapse-weixin:token",
      value: "wx-token-hidden",
    }])
    expect(JSON.stringify(harness.config.global.projects)).not.toContain("wx-token-hidden")
  })

  it("saves manual platform secrets through the main-side secret store", async () => {
    const harness = createSaveHarness()
    const service = new ConnectorQrOnboardingService(harness.options)

    const result = await service.saveManualPlatform({
      projectId: "project-1",
      type: "slack",
      options: {
        bot_token: "xoxb-hidden",
        app_token: "xapp-hidden",
        allow_from: "U1",
      },
    })

    expect(result.connection).toMatchObject({
      type: "slack",
      status: "configured",
      secretRefs: {
        bot_token: "connector:slack:synapse-slack:bot-token",
        app_token: "connector:slack:synapse-slack:app-token",
      },
    })
    expect(harness.secrets.map((secret) => secret.value)).toEqual(["xoxb-hidden", "xapp-hidden"])
    expect(JSON.stringify(harness.config.global.projects)).not.toContain("xoxb-hidden")
    expect(JSON.stringify(harness.config.global.projects)).not.toContain("xapp-hidden")
  })
})
