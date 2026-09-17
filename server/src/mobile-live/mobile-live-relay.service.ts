import { randomUUID } from "node:crypto"
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  type LiveMobileServerMessage,
  type MobileFramePayload,
  type MobileIntent,
  type MobileIntentResult,
  type MobileIntentResultPayload,
  type MobileSummaryPayload,
  type MobileToolbarPayload,
  type MobileTransferProgressPayload,
} from "@synapse/shared"
import { LiveClientRegistry } from "../live/live-client-registry"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { MOBILE_CLIENT_REGISTRY, type MobileLiveFanout } from "./mobile-live.types"
import { MobilePushService } from "./mobile-push.service"

/** How long a caller waits for the desktop to answer an intent. */
const INTENT_RESULT_TIMEOUT_MS = 8_000

/** Summaries are small but unbounded in principle; keep the cache firmly bounded. */
const SUMMARY_CACHE_LIMIT = 200

type PendingIntent = {
  readonly resolve: (result: MobileIntentResult) => void
  readonly timer: NodeJS.Timeout
}

export type IntentDeliveryOutcome =
  | { readonly status: "sent" }
  | { readonly status: "desktop_offline" }
  | { readonly status: "send_failed" }

/**
 * Moves terminal traffic between the two sockets.
 *
 * The cloud stays deliberately thin: it routes frames it does not interpret,
 * remembers only the latest session list per desktop (so a phone shows something
 * immediately on cold start), and never stores terminal output. Rendering,
 * diffing, and leasing all happen on the desktop, which is what makes the
 * bandwidth bound independent of how many terminals are running.
 */
@Injectable()
export class MobileLiveRelayService implements OnModuleInit {
  private readonly logger = new Logger(MobileLiveRelayService.name)
  private readonly summaries = new Map<string, MobileSummaryPayload>()
  private readonly pendingIntents = new Map<string, PendingIntent>()
  /** Last attention state per session, so only transitions notify. */
  private readonly attentionBySession = new Map<string, string>()
  private fanout: MobileLiveFanout | null = null

  constructor(
    @Inject(MOBILE_CLIENT_REGISTRY) private readonly mobileRegistry: LiveClientRegistry,
    private readonly desktopGateway: LiveDesktopGateway,
    private readonly push: MobilePushService,
  ) {}

  /**
   * Installed by the mobile gateway rather than injected, because the gateway
   * also needs this service to route intents — a constructor dependency in both
   * directions would be a cycle.
   */
  setFanout(fanout: MobileLiveFanout): void {
    this.fanout = fanout
  }

  onModuleInit(): void {
    // The desktop gateway cannot depend on this service directly: the relay needs
    // the gateway to deliver in the other direction, and a constructor dependency
    // each way would be a cycle.
    this.desktopGateway.setMobileRelayHandler({
      handleSummary: (userId, payload) => this.handleSummary(userId, payload),
      handleFrame: (userId, payload) => this.handleFrame(userId, payload),
      handleIntentResult: (userId, payload) => this.handleIntentResult(userId, payload),
      handleTransferProgress: (userId, payload) => this.handleTransferProgress(userId, payload),
      handleToolbar: (userId, payload) => this.handleToolbar(userId, payload),
      handleDesktopPresence: (userId, clientInstanceIds) =>
        this.handleDesktopPresence(userId, clientInstanceIds),
    })
  }

  /* ---------------------------------------------------------------- *
   * Desktop → phone
   * ---------------------------------------------------------------- */

  handleSummary(userId: string, payload: MobileSummaryPayload): void {
    this.summaries.set(summaryKey(userId, payload.desktopClientInstanceId), payload)
    this.forgetDepartedSessions(userId, payload)
    this.evictSummaries()
    // Detected here rather than pushed by the desktop: the summary already carries
    // attention state, and a transition is exactly what a notification is for. That
    // keeps the desktop out of the business of deciding who to notify.
    this.notifyAttentionTransitions(userId, payload)
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileSummary, payload, envelopeMeta())
    // A phone filters by `desktopClientInstanceId`, so the summary is fanned out
    // to every phone of the user rather than tracked per subscription.
    for (const client of this.mobileRegistry.listOnlineByUser(userId)) {
      this.fanout?.sendToMobile({ userId, clientInstanceId: client.clientInstanceId, message })
    }
  }

  /**
   * Sessions vanish from the summary when their PTY exits, so an attention entry
   * for a session that is no longer listed would otherwise be remembered forever.
   */
  private forgetDepartedSessions(userId: string, payload: MobileSummaryPayload): void {
    const present = new Set(payload.sessions.map((session) => summaryKey(userId, `${payload.desktopClientInstanceId}:${session.id}`)))
    for (const key of this.attentionBySession.keys()) {
      if (!key.startsWith(`${userId}:${payload.desktopClientInstanceId}:`)) continue
      if (!present.has(key)) this.attentionBySession.delete(key)
    }
  }

  private notifyAttentionTransitions(userId: string, payload: MobileSummaryPayload): void {
    for (const session of payload.sessions) {
      const key = summaryKey(userId, `${payload.desktopClientInstanceId}:${session.id}`)
      const previous = this.attentionBySession.get(key)
      this.attentionBySession.set(key, session.attention.state)
      // Only a fresh transition into "waiting" is worth waking someone for.
      // `unknown` is explicitly not `not_waiting`, but it is also not evidence
      // that a person is needed, so it never notifies.
      if (session.attention.state !== "waiting" || previous === "waiting") continue
      void this.push.sendTerminalApproval(userId, {
        title: `${session.title} 需要你确认`,
        body: session.lastLine.trim() || "有一个终端正在等待你的操作。",
        detail: session.lastLine,
        desktopClientInstanceId: payload.desktopClientInstanceId,
        sessionId: session.id,
        sessionTitle: session.title,
      }).catch((error: unknown) => {
        this.logger.warn({
          errorName: error instanceof Error ? error.name : typeof error,
          sessionId: session.id,
        }, "Mobile attention push failed")
      })
    }
  }

  /**
   * A computer signed in or dropped out.
   *
   * A phone's socket is to the cloud, not to a computer, so nothing about a
   * desktop coming or going reaches it otherwise: without this it keeps showing
   * "电脑离线" until some unrelated action makes it ask again. Fanned out to every
   * phone of the user, because any of them could be the one being looked at.
   */
  handleDesktopPresence(userId: string, desktopClientInstanceIds: readonly string[]): void {
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobilePresence, {
      desktopClientInstanceIds,
    }, envelopeMeta())
    for (const client of this.mobileRegistry.listOnlineByUser(userId)) {
      this.fanout?.sendToMobile({ userId, clientInstanceId: client.clientInstanceId, message })
    }
  }

  handleFrame(userId: string, payload: MobileFramePayload): void {
    // Frames are only ever for the phone that attached, and a missed frame is
    // worthless: the next one carries a superseding suffix.
    this.fanout?.sendToMobile({
      userId,
      clientInstanceId: payload.mobileClientInstanceId,
      message: createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileFrame, payload, envelopeMeta()),
    })
  }

  /**
   * How far along a computer is in fetching a relayed file.
   *
   * Addressed to the one phone that sent the intent rather than fanned out: unlike a
   * summary, which every phone needs so it can show a list, this only means anything
   * to the device whose own chip is waiting on it. Nothing is cached here — a lost
   * progress message costs a later one, not a wrong answer.
   */
  handleTransferProgress(userId: string, payload: MobileTransferProgressPayload): void {
    this.fanout?.sendToMobile({
      userId,
      clientInstanceId: payload.mobileClientInstanceId,
      message: createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileTransferProgress, payload, envelopeMeta()),
    })
  }

  /**
   * The command buttons one of the user's computers offers.
   *
   * Fanned out to every phone of the account, like a summary and unlike a frame:
   * the payload names its own computer, and each phone keeps only the list belonging
   * to the computer it is showing, so sending it to a phone that is looking at a
   * different one costs a comparison and nothing else.
   *
   * Deliberately not cached. A phone that connects mid-session asks for this
   * directly — its `sync` intent reaches the desktop, which answers — so a cache
   * would only exist to serve a phone whose computer has since gone away, and there
   * it would be wrong: the buttons would run commands on a machine that is no longer
   * there.
   */
  handleToolbar(userId: string, payload: MobileToolbarPayload): void {
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileToolbar, payload, envelopeMeta())
    for (const client of this.mobileRegistry.listOnlineByUser(userId)) {
      this.fanout?.sendToMobile({ userId, clientInstanceId: client.clientInstanceId, message })
    }
  }

  handleIntentResult(userId: string, payload: MobileIntentResultPayload): void {
    const pending = this.pendingIntents.get(payload.result.intentId)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingIntents.delete(payload.result.intentId)
      pending.resolve(payload.result)
    }
    this.fanout?.sendToMobile({
      userId,
      clientInstanceId: payload.mobileClientInstanceId,
      message: createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileIntentResult, payload, envelopeMeta()),
    })
  }

  /* ---------------------------------------------------------------- *
   * Phone → desktop
   * ---------------------------------------------------------------- */

  /**
   * Hands an intent to the desktop that owns the terminal.
   *
   * When `waitForResultMs` is set the call resolves once the desktop answers.
   * That exists for notification actions: a lock-screen tap has no websocket to
   * receive the asynchronous result on, so the request has to carry it back.
   */
  async deliverIntent(input: {
    readonly userId: string
    readonly mobileClientInstanceId: string
    readonly desktopClientInstanceId: string
    readonly intent: MobileIntent
    readonly waitForResultMs?: number
  }): Promise<{ readonly delivery: IntentDeliveryOutcome; readonly result?: MobileIntentResult }> {
    const pending = this.waitFor(input.intent.intentId, input.waitForResultMs)
    const status = this.desktopGateway.sendToClientInstance({
      userId: input.userId,
      clientInstanceId: input.desktopClientInstanceId,
      message: createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileIntent, {
        desktopClientInstanceId: input.desktopClientInstanceId,
        mobileClientInstanceId: input.mobileClientInstanceId,
        intent: input.intent,
      }, envelopeMeta()),
    })
    if (status !== "sent") {
      this.abandonPending(input.intent.intentId)
      return {
        delivery: { status: status === "offline" ? "desktop_offline" : "send_failed" },
      }
    }
    if (!pending) return { delivery: { status: "sent" } }
    return { delivery: { status: "sent" }, result: await pending }
  }

  /** The last session list a desktop published, for a phone that just connected. */
  cachedSummary(userId: string, desktopClientInstanceId: string): MobileSummaryPayload | null {
    return this.summaries.get(summaryKey(userId, desktopClientInstanceId)) ?? null
  }

  /** Desktops this user could target, so a phone can tell "no computer" from "wrong id". */
  onlineDesktops(userId: string): string[] {
    return this.desktopGateway.listOnlineClientInstanceIds(userId)
  }

  /**
   * A phone's socket closed. Every desktop of that user is told, because only the
   * desktops know which terminals that phone had open and therefore which write
   * leases to release.
   */
  handleMobileDisconnect(userId: string, mobileClientInstanceId: string, reason: string): void {
    for (const clientInstanceId of this.onlineDesktops(userId)) {
      this.desktopGateway.sendToClientInstance({
        userId,
        clientInstanceId,
        message: createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileDetached, {
          mobileClientInstanceId,
          reason,
        }, envelopeMeta()),
      })
    }
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private waitFor(intentId: string, waitMs: number | undefined): Promise<MobileIntentResult> | null {
    if (!waitMs || waitMs <= 0) return null
    return new Promise<MobileIntentResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingIntents.delete(intentId)
        resolve({
          intentId,
          outcome: "rejected",
          code: "timeout",
          message: "电脑没有及时响应。",
        })
      }, Math.min(waitMs, INTENT_RESULT_TIMEOUT_MS))
      timer.unref?.()
      this.pendingIntents.set(intentId, { resolve, timer })
    })
  }

  private abandonPending(intentId: string): void {
    const pending = this.pendingIntents.get(intentId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingIntents.delete(intentId)
  }

  private evictSummaries(): void {
    if (this.summaries.size <= SUMMARY_CACHE_LIMIT) return
    const oldest = this.summaries.keys().next()
    if (!oldest.done) this.summaries.delete(oldest.value)
  }
}

function summaryKey(userId: string, desktopClientInstanceId: string): string {
  return `${userId}:${desktopClientInstanceId}`
}

function envelopeMeta(): { readonly id: string; readonly sentAt: string } {
  return { id: randomUUID(), sentAt: new Date().toISOString() }
}
