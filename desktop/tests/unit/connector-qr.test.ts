import { describe, expect, it } from "vitest"
import {
  ConnectorQrOnboardingService,
  resolveFeishuSetupInputs,
  resolveWeixinSetupMode,
} from "../../electron/services/connector-qr-onboarding-service"

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
})
