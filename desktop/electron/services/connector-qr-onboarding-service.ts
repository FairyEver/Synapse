export type ConnectorQrPlatform = "feishu" | "lark" | "weixin"
export type ConnectorQrStatus = "waiting" | "scanned" | "success" | "expired" | "denied" | "cancelled" | "failed"

export type FeishuRegistrationInit = {
  supportedAuthMethods?: string[]
  error?: string
  errorDescription?: string
}

export type FeishuRegistrationBegin = {
  deviceCode?: string
  verificationUriComplete?: string
  interval?: number
  expireIn?: number
  error?: string
  errorDescription?: string
}

export type FeishuRegistrationPoll = {
  clientId?: string
  clientSecret?: string
  ownerOpenId?: string
  tenantBrand?: string
  error?: string
  errorDescription?: string
}

export type WeixinQrPayload = {
  qrCode?: string
  qrCodeImageContent?: string
}

export type WeixinQrPoll = {
  status?: string
  botToken?: string
  ilinkBotId?: string
  baseUrl?: string
  ilinkUserId?: string
}

export type ConnectorQrSession = {
  id: string
  platform: ConnectorQrPlatform
  status: ConnectorQrStatus
  mode: "new" | "bind"
  qrContent: string | null
  deviceCode: string | null
  intervalSeconds: number
  expiresAt: string | null
  refreshCount: number
  result: Record<string, string> | null
  error: string | null
}

let sequence = 0

function trimString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function sessionId(platform: ConnectorQrPlatform): string {
  sequence += 1
  return `qr:${platform}:${sequence}`
}

function errorText(code: string, description: string | undefined): string {
  return description ? `${code}: ${description}` : code
}

export function resolveFeishuSetupInputs(
  requestedMode: "auto" | "new" | "bind",
  app: string,
  appId: string,
  appSecret: string,
): { mode: "new" | "bind"; appId: string | null; appSecret: string | null; error: string | null } {
  const pair = trimString(app)
  let resolvedAppId = trimString(appId) ?? ""
  let resolvedSecret = trimString(appSecret) ?? ""

  if (pair && (resolvedAppId || resolvedSecret)) {
    return { mode: "new", appId: null, appSecret: null, error: "use either --app or --app-id/--app-secret, not both" }
  }

  if (pair) {
    const separator = pair.indexOf(":")
    if (separator <= 0 || separator >= pair.length - 1) {
      return { mode: "new", appId: null, appSecret: null, error: "--app format must be app_id:app_secret" }
    }
    resolvedAppId = pair.slice(0, separator).trim()
    resolvedSecret = pair.slice(separator + 1).trim()
  }

  if ((resolvedAppId && !resolvedSecret) || (!resolvedAppId && resolvedSecret)) {
    return { mode: "new", appId: null, appSecret: null, error: "both --app-id and --app-secret are required" }
  }

  const mode = requestedMode === "auto"
    ? resolvedAppId && resolvedSecret ? "bind" : "new"
    : requestedMode

  if (mode === "bind" && (!resolvedAppId || !resolvedSecret)) {
    return { mode, appId: null, appSecret: null, error: "bind mode requires credentials: use --app id:secret or --app-id/--app-secret" }
  }

  if (mode === "new" && (resolvedAppId || resolvedSecret)) {
    return { mode, appId: null, appSecret: null, error: "new mode does not accept credentials; use `cc-connect feishu bind`" }
  }

  return {
    mode,
    appId: resolvedAppId || null,
    appSecret: resolvedSecret || null,
    error: null,
  }
}

export function resolveWeixinSetupMode(
  requestedMode: "auto" | "new" | "bind",
  token: string,
): { mode: "new" | "bind"; error: string | null } {
  const hasToken = Boolean(trimString(token))
  if (requestedMode === "auto") {
    return { mode: hasToken ? "bind" : "new", error: null }
  }
  if (requestedMode === "bind" && !hasToken) {
    return { mode: "bind", error: "bind mode requires --token" }
  }
  if (requestedMode === "new" && hasToken) {
    return { mode: "new", error: "new/QR mode does not accept --token; use `cc-connect weixin bind --token ...`" }
  }
  return { mode: requestedMode, error: null }
}

export class ConnectorQrOnboardingService {
  beginFeishuRegistration(
    init: FeishuRegistrationInit,
    begin: FeishuRegistrationBegin,
    options: { timeoutSeconds?: number; now?: Date } = {},
  ): ConnectorQrSession {
    const supported = init.supportedAuthMethods ?? []
    if (init.error) {
      return this.failed("feishu", errorText(init.error, init.errorDescription))
    }
    if (supported.length > 0 && !supported.includes("client_secret")) {
      return this.failed("feishu", "current environment does not support client_secret auth")
    }
    if (begin.error) {
      return this.failed("feishu", errorText(begin.error, begin.errorDescription))
    }

    const deviceCode = trimString(begin.deviceCode)
    const qrContent = trimString(begin.verificationUriComplete)
    if (!deviceCode || !qrContent) {
      return this.failed("feishu", "incomplete onboarding response")
    }

    const timeoutSeconds = options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds : 600
    const expireIn = begin.expireIn && begin.expireIn > 0 ? Math.min(begin.expireIn, timeoutSeconds) : timeoutSeconds
    const now = options.now ?? new Date()

    return {
      id: sessionId("feishu"),
      platform: "feishu",
      status: "waiting",
      mode: "new",
      qrContent,
      deviceCode,
      intervalSeconds: begin.interval && begin.interval > 0 ? begin.interval : 5,
      expiresAt: new Date(now.getTime() + expireIn * 1000).toISOString(),
      refreshCount: 0,
      result: null,
      error: null,
    }
  }

  pollFeishuRegistration(session: ConnectorQrSession, poll: FeishuRegistrationPoll): ConnectorQrSession {
    if (session.status !== "waiting" && session.status !== "scanned") {
      return session
    }

    const tenantBrand = trimString(poll.tenantBrand)?.toLowerCase()
    const platform: ConnectorQrPlatform = tenantBrand === "lark" ? "lark" : session.platform
    const clientId = trimString(poll.clientId)
    const clientSecret = trimString(poll.clientSecret)
    if (clientId && clientSecret) {
      return {
        ...session,
        platform,
        status: "success",
        result: {
          appId: clientId,
          appSecret: clientSecret,
          ...(trimString(poll.ownerOpenId) ? { ownerOpenId: trimString(poll.ownerOpenId) as string } : {}),
        },
      }
    }

    switch (poll.error) {
      case undefined:
      case "":
      case "authorization_pending":
        return { ...session, platform, status: "waiting" }
      case "slow_down":
        return { ...session, platform, intervalSeconds: session.intervalSeconds + 5 }
      case "access_denied":
        return { ...session, platform, status: "denied", error: "authorization denied by user" }
      case "expired_token":
        return { ...session, platform, status: "expired", error: "onboarding session expired" }
      default:
        return { ...session, platform, status: "failed", error: errorText(poll.error ?? "unknown_error", poll.errorDescription) }
    }
  }

  beginWeixinQr(payload: WeixinQrPayload): ConnectorQrSession {
    const qrContent = trimString(payload.qrCodeImageContent)
    const deviceCode = trimString(payload.qrCode)
    if (!qrContent || !deviceCode) {
      return this.failed("weixin", "empty qrcode_img_content from server")
    }

    return {
      id: sessionId("weixin"),
      platform: "weixin",
      status: "waiting",
      mode: "new",
      qrContent,
      deviceCode,
      intervalSeconds: 1,
      expiresAt: null,
      refreshCount: 1,
      result: null,
      error: null,
    }
  }

  pollWeixinQr(session: ConnectorQrSession, poll: WeixinQrPoll): ConnectorQrSession {
    if (session.platform !== "weixin" || (session.status !== "waiting" && session.status !== "scanned")) {
      return session
    }

    switch (poll.status) {
      case undefined:
      case "":
      case "wait":
        return { ...session, status: "waiting" }
      case "scaned":
        return { ...session, status: "scanned" }
      case "expired":
        return { ...session, status: "expired", refreshCount: session.refreshCount + 1, error: "qrcode expired" }
      case "confirmed": {
        const botToken = trimString(poll.botToken)
        const ilinkBotId = trimString(poll.ilinkBotId)
        if (!ilinkBotId) {
          return { ...session, status: "failed", error: "login confirmed but ilink_bot_id missing" }
        }
        if (!botToken) {
          return { ...session, status: "failed", error: "login confirmed but bot_token missing" }
        }
        return {
          ...session,
          status: "success",
          result: {
            botToken,
            ilinkBotId,
            ...(trimString(poll.baseUrl) ? { baseUrl: trimString(poll.baseUrl) as string } : {}),
            ...(trimString(poll.ilinkUserId) ? { ilinkUserId: trimString(poll.ilinkUserId) as string } : {}),
          },
        }
      }
      default:
        return { ...session, status: "waiting" }
    }
  }

  cancel(session: ConnectorQrSession): ConnectorQrSession {
    return { ...session, status: "cancelled" }
  }

  private failed(platform: ConnectorQrPlatform, error: string): ConnectorQrSession {
    return {
      id: sessionId(platform),
      platform,
      status: "failed",
      mode: "new",
      qrContent: null,
      deviceCode: null,
      intervalSeconds: 0,
      expiresAt: null,
      refreshCount: 0,
      result: null,
      error,
    }
  }
}
