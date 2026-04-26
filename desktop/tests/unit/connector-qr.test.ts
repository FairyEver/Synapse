import { describe, expect, it } from "vitest"
import { createDefaultConfig } from "../../src/lib/config"
import { summarizeCcConnectProjects } from "../../src/modules/connectors/project-model"
import {
  ConnectorQrOnboardingService,
  type ConnectorQrHttpClient,
  resolveFeishuSetupInputs,
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

  it("keeps waiting when Feishu poll returns OAuth 400 authorization_pending", async () => {
    const { client } = createMockHttpClient([
      { body: { supported_auth_methods: ["client_secret"] } },
      { body: { device_code: "device-1", verification_uri_complete: "https://qr.example.test", interval: 2, expire_in: 90 } },
      { status: 400, body: { error: "authorization_pending" } },
    ])
    const service = new ConnectorQrOnboardingService({ httpClient: client })
    const session = await service.beginQr("feishu")

    await expect(service.pollQr(session.sessionId)).resolves.toMatchObject({
      status: "waiting",
      error: null,
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

  it("saves Lark app_secret into secret refs after registration completion", async () => {
    const harness = createSaveHarness()
    const { client } = createMockHttpClient([
      { body: { supported_auth_methods: ["client_secret"] } },
      { body: { device_code: "device-1", verification_uri_complete: "https://qr.example.test" } },
      { body: { error: "authorization_pending", user_info: { tenant_brand: "lark" } } },
      { body: { client_id: "cli_lark", client_secret: "sec_lark_hidden", user_info: { tenant_brand: "lark", open_id: "ou_owner" } } },
    ])
    const service = new ConnectorQrOnboardingService({
      ...harness.options,
      httpClient: client,
    })
    const session = await service.beginQr("lark")
    const completed = await service.pollQr(session.sessionId)

    expect(completed).toMatchObject({
      platform: "lark",
      status: "success",
      result: {
        appId: "cli_lark",
        ownerOpenId: "ou_owner",
      },
    })
    expect(JSON.stringify(completed)).not.toContain("sec_lark_hidden")
    const result = await service.saveCompletedQr({ sessionId: session.sessionId, projectId: "project-1" })

    expect(result.connection).toMatchObject({
      type: "lark",
      status: "configured",
      options: {
        app_id: "cli_lark",
        owner_open_id: "ou_owner",
      },
      secretRefs: {
        app_secret: "connector:lark:synapse-lark:app-secret",
      },
    })
    expect(harness.secrets).toEqual([{
      id: "connector:lark:synapse-lark:app-secret",
      value: "sec_lark_hidden",
    }])
    expect(JSON.stringify(harness.config.global.projects)).not.toContain("sec_lark_hidden")
  })

  it("rejects manual saves for unsupported legacy platforms", async () => {
    const harness = createSaveHarness()
    const service = new ConnectorQrOnboardingService(harness.options)

    await expect(service.saveManualPlatform({
      projectId: "project-1",
      type: "slack",
      options: {
        bot_token: "xoxb-hidden",
        app_token: "xapp-hidden",
        allow_from: "U1",
      },
    })).rejects.toThrow("当前仅支持新增 Feishu 或 Lark。")
    expect(harness.secrets).toEqual([])
    expect(harness.config.global.projects[0]?.platformConnections).toEqual([])
  })
})
