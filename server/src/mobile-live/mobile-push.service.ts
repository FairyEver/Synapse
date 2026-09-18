import { createSign } from "node:crypto"
import { readFile } from "node:fs/promises"
import { connect } from "node:http2"
import { Injectable, Logger } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { MobileDeviceService } from "./mobile-device.service"

/** Apple rejects tokens issued more than an hour ago; refresh well inside that. */
const TOKEN_TTL_MS = 45 * 60_000

const PRODUCTION_HOST = "https://api.push.apple.com"
const SANDBOX_HOST = "https://api.sandbox.push.apple.com"

export type TerminalApprovalPush = {
  readonly title: string
  readonly body: string
  readonly desktopClientInstanceId: string
  readonly sessionId: string
  readonly sessionTitle: string
  /**
   * The session's most recent meaningful line. Shown on the expanded
   * notification so the user has real context before tapping through, rather
   * than an alert that only says something needs attention.
   */
  readonly detail: string
}

/**
 * A finished meeting transcription.
 *
 * The phone is a separate device from the desktop, so this is worth sending even
 * when the desktop is online — the user is often away from the desk by the time
 * a long recording finishes.
 */
/**
 * What a push actually carries once it reaches APNs.
 *
 * `data` is merged into the payload root — that is where the app reads it back
 * from `userInfo`, and it is per-category rather than inside `aps`.
 */
type PushContent = {
  readonly title: string
  readonly body: string
  readonly category: string
  readonly threadId: string
  readonly data: Record<string, unknown>
}

function terminalApprovalContent(push: TerminalApprovalPush): PushContent {
  return {
    title: push.title,
    body: push.body,
    // Matches the category the app registers, so the lock screen offers
    // approve/deny without opening the app.
    category: "TERMINAL_APPROVAL",
    threadId: push.sessionId,
    data: {
      desktopClientInstanceId: push.desktopClientInstanceId,
      sessionId: push.sessionId,
      sessionTitle: push.sessionTitle,
      detail: push.detail,
    },
  }
}

function meetingTranscriptionContent(push: MeetingTranscriptionPush): PushContent {
  return {
    title: push.title,
    body: push.body,
    category: "MEETING_TRANSCRIPTION",
    // 一场会议通知一条：同一个 thread 会覆盖而不是堆一屏。
    threadId: push.meetingId,
    data: {
      meetingId: push.meetingId,
      detail: push.detail,
    },
  }
}

export type MeetingTranscriptionPush = {
  readonly title: string
  readonly body: string
  readonly meetingId: string
  readonly detail: string
}

export type PushOutcome = {
  readonly sent: number
  readonly failed: number
  readonly skipped: boolean
}

/**
 * Sends APNs notifications for terminal attention changes.
 *
 * Hand-rolled on `node:http2` and `node:crypto` rather than pulling in a library:
 * the whole surface is one POST with a JWT, and the deployment already avoids
 * adding dependencies for transport it can express directly.
 *
 * Degrades to a no-op when no key is configured, so a deployment without APNs
 * credentials still runs — the in-app inbox keeps working, only the lock-screen
 * delivery is missing.
 */
@Injectable()
export class MobilePushService {
  private readonly logger = new Logger(MobilePushService.name)
  private readonly env = loadEnv(process.env)
  private cachedToken: { readonly value: string; readonly mintedAtMs: number } | null = null
  private cachedKey: string | null = null

  constructor(private readonly devices: MobileDeviceService) {}

  isConfigured(): boolean {
    return Boolean(this.env.apnsKeyId && this.env.apnsTeamId && this.env.apnsKeyPath)
  }

  /**
   * Notifies every phone the account registered.
   *
   * A phone whose token Apple rejects is unregistered rather than retried: the
   * token is reissued on reinstall, so a rejected one will never work again.
   */
  async sendTerminalApproval(userId: string, push: TerminalApprovalPush): Promise<PushOutcome> {
    return this.sendToAllDevices(userId, terminalApprovalContent(push))
  }

  /** 转写收尾时通知手机。 */
  async sendMeetingTranscription(userId: string, push: MeetingTranscriptionPush): Promise<PushOutcome> {
    return this.sendToAllDevices(userId, meetingTranscriptionContent(push))
  }

  private async sendToAllDevices(userId: string, content: PushContent): Promise<PushOutcome> {
    if (!this.isConfigured()) {
      this.logger.warn({ reason: "not_configured" }, "Mobile push skipped")
      return { sent: 0, failed: 0, skipped: true }
    }
    const targets = await this.devices.listPushTargets(userId)
    if (targets.length === 0) return { sent: 0, failed: 0, skipped: false }

    let token: string
    try {
      token = await this.authorizationToken()
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Mobile push authorization failed")
      return { sent: 0, failed: targets.length, skipped: false }
    }

    let sent = 0
    let failed = 0
    for (const target of targets) {
      const status = await this.deliver(token, target.token, content)
      if (status === "sent") {
        sent += 1
        await this.devices.recordPushAttempt(target.clientInstanceId, userId).catch(() => undefined)
        continue
      }
      failed += 1
      if (status === "unregistered") {
        await this.devices.dropPushToken(target.token).catch(() => undefined)
      }
    }
    return { sent, failed, skipped: false }
  }

  private async deliver(
    authorization: string,
    deviceToken: string,
    content: PushContent,
  ): Promise<"sent" | "unregistered" | "failed"> {
    const host = this.env.apnsUseSandbox ? SANDBOX_HOST : PRODUCTION_HOST
    const body = JSON.stringify({
      aps: {
        alert: { title: content.title, body: content.body },
        sound: "default",
        // Matches the category the app registers, so the lock screen can offer
        // per-category actions without opening the app.
        category: content.category,
        "thread-id": content.threadId,
      },
      ...content.data,
    })

    return new Promise((resolve) => {
      const client = connect(host)
      let settled = false
      const finish = (result: "sent" | "unregistered" | "failed"): void => {
        if (settled) return
        settled = true
        client.close()
        resolve(result)
      }
      client.on("error", (error) => {
        this.logger.warn({
          errorName: error instanceof Error ? error.name : typeof error,
        }, "Mobile push transport failed")
        finish("failed")
      })
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${authorization}`,
        "apns-topic": this.env.apnsBundleId ?? "com.liy.SynapseMobile",
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      })
      let status = 0
      let responseBody = ""
      request.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0)
      })
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => {
        responseBody += chunk
      })
      request.on("error", () => finish("failed"))
      request.on("end", () => {
        if (status === 200) return finish("sent")
        // 410 and BadDeviceToken mean the token is dead for good.
        if (status === 410 || responseBody.includes("BadDeviceToken") || responseBody.includes("Unregistered")) {
          this.logger.warn({ status }, "Mobile push token rejected")
          return finish("unregistered")
        }
        this.logger.warn({
          status,
          // Apple's reason string is safe to log; the token and body are not.
          reason: extractReason(responseBody),
        }, "Mobile push delivery failed")
        finish("failed")
      })
      request.end(body)
    })
  }

  /** ES256 JWT, cached until well inside Apple's one-hour validity window. */
  private async authorizationToken(): Promise<string> {
    const nowMs = Date.now()
    if (this.cachedToken && nowMs - this.cachedToken.mintedAtMs < TOKEN_TTL_MS) {
      return this.cachedToken.value
    }
    const keyId = this.env.apnsKeyId
    const teamId = this.env.apnsTeamId
    const keyPath = this.env.apnsKeyPath
    if (!keyId || !teamId || !keyPath) throw new Error("APNs credentials are incomplete")
    if (!this.cachedKey) this.cachedKey = await readFile(keyPath, "utf8")

    const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }))
    const claims = base64Url(JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }))
    const signingInput = `${header}.${claims}`
    const signer = createSign("SHA256")
    signer.update(signingInput)
    // JWS wants the raw R||S pair; Node's default DER encoding would be rejected.
    const signature = signer.sign({ key: this.cachedKey, dsaEncoding: "ieee-p1363" })
    const value = `${signingInput}.${signature.toString("base64url")}`
    this.cachedToken = { value, mintedAtMs: nowMs }
    return value
  }
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function extractReason(responseBody: string): string | undefined {
  try {
    const parsed = JSON.parse(responseBody) as { readonly reason?: unknown }
    return typeof parsed.reason === "string" ? parsed.reason : undefined
  } catch {
    return undefined
  }
}
