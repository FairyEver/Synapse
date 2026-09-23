import { randomUUID } from "node:crypto"
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  type LiveMobileServerMessage,
  type MobileClipboardPayload,
  type MobileFramePayload,
  type MobileGitStatusPayload,
  type MobileIntent,
  type MobileIntentResult,
  type MobileIntentResultPayload,
  type MobileQuickPhrasesPayload,
  type MobileSummaryPayload,
  type MobileToolbarPayload,
  type MobileTransferProgressPayload,
} from "@synapse/shared"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import type { LiveReachableDesktop } from "../live/live.types"
import type { MobileLiveFanout } from "./mobile-live.types"
import { MobilePushService } from "./mobile-push.service"
import type { NotificationService } from "../notifications/notification.service"

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
  /**
   * Last attention state per session, so only transitions notify.
   *
   * Keyed by user and then by computer rather than by one flat
   * `user:computer:session` string. Every summary has to drop the sessions it no
   * longer lists, and on a flat map that meant walking every entry on the server
   * once a second per computer to find the handful belonging to the sender.
   */
  private readonly attentionByUser = new Map<string, Map<string, Map<string, string>>>()
  private fanout: MobileLiveFanout | null = null
  private notifications: Pick<NotificationService, "create" | "resolveAttention"> | null = null

  constructor(
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

  setNotificationSink(sink: Pick<NotificationService, "create" | "resolveAttention">): void {
    this.notifications = sink
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
      handleQuickPhrases: (userId, payload) => this.handleQuickPhrases(userId, payload),
      handleClipboard: (userId, payload) => this.handleClipboard(userId, payload),
      handleGitStatus: (userId, payload) => this.handleGitStatus(userId, payload),
      handleDesktopPresence: (userId, clientInstanceIds) =>
        this.handleDesktopPresence(userId, clientInstanceIds),
    })
  }

  /* ---------------------------------------------------------------- *
   * Desktop → phone
   * ---------------------------------------------------------------- */

  handleSummary(userId: string, payload: MobileSummaryPayload): void {
    // Re-inserted rather than written in place: `Map.set` on a key it already holds
    // keeps that key's original position, so an updated summary would keep its old
    // slot and `evictSummaries` would drop the computer that publishes most often —
    // the one a phone cold-starting is most likely to need — while keeping one that
    // went quiet long ago. Deleting first moves the key to the end.
    const cached = summaryKey(userId, payload.desktopClientInstanceId)
    this.summaries.delete(cached)
    this.summaries.set(cached, payload)
    this.forgetDepartedSessions(userId, payload)
    this.evictSummaries()
    // Detected here rather than pushed by the desktop: the summary already carries
    // attention state, and a transition is exactly what a notification is for. That
    // keeps the desktop out of the business of deciding who to notify.
    this.notifyAttentionTransitions(userId, payload)
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileSummary, payload, envelopeMeta())
    // A phone filters by `desktopClientInstanceId`, so the summary is fanned out
    // to every phone of the user rather than tracked per subscription.
    this.fanout?.sendToMobileClients({ userId, message })
  }

  /**
   * Sessions vanish from the summary when their PTY exits, so an attention entry
   * for a session that is no longer listed would otherwise be remembered forever.
   *
   * Only the sending computer's own states are looked at: the summary carries the
   * whole list for that computer, so nothing else can have departed.
   */
  private forgetDepartedSessions(userId: string, payload: MobileSummaryPayload): void {
    const sessions = this.attentionByUser.get(userId)?.get(payload.desktopClientInstanceId)
    if (!sessions) return
    const present = new Set(payload.sessions.map((session) => session.id))
    for (const sessionId of sessions.keys()) {
      if (!present.has(sessionId)) {
        sessions.delete(sessionId)
        void this.notifications?.resolveAttention(userId, payload.desktopClientInstanceId, sessionId)
      }
    }
  }

  /** The attention states of one computer, created on first use. */
  private attentionFor(userId: string, desktopClientInstanceId: string): Map<string, string> {
    const byDesktop = this.attentionByUser.get(userId) ?? new Map<string, Map<string, string>>()
    this.attentionByUser.set(userId, byDesktop)
    const sessions = byDesktop.get(desktopClientInstanceId) ?? new Map<string, string>()
    byDesktop.set(desktopClientInstanceId, sessions)
    return sessions
  }

  private notifyAttentionTransitions(userId: string, payload: MobileSummaryPayload): void {
    const sessions = this.attentionFor(userId, payload.desktopClientInstanceId)
    for (const session of payload.sessions) {
      const previous = sessions.get(session.id)
      sessions.set(session.id, session.attention.state)
      if (previous === "waiting" && session.attention.state !== "waiting") {
        void this.notifications?.resolveAttention(userId, payload.desktopClientInstanceId, session.id)
      }
      // Only a fresh transition into "waiting" is worth waking someone for.
      // `unknown` is explicitly not `not_waiting`, but it is also not evidence
      // that a person is needed, so it never notifies.
      if (session.attention.state !== "waiting" || previous === "waiting") continue
      if (payload.notificationsEnabled === false) continue
      if (this.notifications) {
        void this.notifications.create({
          userId,
          source: "terminal-attention",
          title: `${session.title} 需要你确认`,
          body: "有一个终端正在等待你的操作。",
          targetId: session.id,
          deviceId: payload.desktopClientInstanceId,
        }).catch((error: unknown) => {
          this.logger.warn({ errorName: error instanceof Error ? error.name : typeof error }, "Attention notification persistence failed")
        })
        continue
      }
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
    this.fanout?.sendToMobileClients({ userId, message })
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
    this.fanout?.sendToMobileClients({ userId, message })
  }

  /**
   * The 快捷输入 sentences one of the user's computers keeps, for its phones to tap
   * into a composer instead of typing.
   *
   * Fanned out and not cached, on exactly `handleToolbar`'s terms: the payload names
   * its own computer, so a phone looking at a different one filters it out for the
   * cost of a comparison, and a phone that connects mid-session is answered by the
   * desktop when its `sync` intent arrives rather than by anything held here. A cache
   * would only ever serve a phone whose computer has since gone, and it would be
   * wrong there: the sentences are the user's own text and its author could no longer
   * change them.
   *
   * Not a request either — no `pendingIntents`, no result, no retry. A phone that
   * misses this one asks again the next time it attaches, and until then it shows the
   * last list it had, which is what the toolbar does.
   */
  handleQuickPhrases(userId: string, payload: MobileQuickPhrasesPayload): void {
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileQuickPhrases, payload, envelopeMeta())
    this.fanout?.sendToMobileClients({ userId, message })
  }

  /**
   * The text one of the user's computers copied recently, for its phones to read and
   * copy into their own clipboard.
   *
   * Fanned out and never stored, on `handleQuickPhrases`' terms. This one has an
   * extra reason of its own: its whole meaning is recency. A stored copy would
   * answer a phone with text its computer copied hours ago and has long since
   * replaced, and would keep answering after that computer had gone away entirely.
   *
   * Not a request either, and no result to wait on: the desktop re-sends this when a
   * phone's `sync` intent arrives, which is the path every snapshot on this wire
   * already takes.
   */
  handleClipboard(userId: string, payload: MobileClipboardPayload): void {
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileClipboard, payload, envelopeMeta())
    this.fanout?.sendToMobileClients({ userId, message })
  }

  /**
   * 一台电脑上、一个终端当前目录的 Git 状态。
   *
   * 点对点发给那一台手机，像 `handleFrame` 而不像 `handleToolbar`：它答的是
   * 「你正开着的那个终端」，而这句话只对问它的那台手机成立。payload 自己带着收件人的
   * `mobileClientInstanceId`，所以这里不需要把「谁订阅了什么」再记一份。
   *
   * 不缓存，理由与上面三条相同。电脑在手机的 `sync` 与 `attach` 两个时刻都会重发一次，
   * 所以一台不在线的电脑留下的缓存没有存在的必要，而有的话它一定是错的。
   */
  handleGitStatus(userId: string, payload: MobileGitStatusPayload): void {
    this.fanout?.sendToMobile({
      userId,
      clientInstanceId: payload.mobileClientInstanceId,
      message: createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileGitStatus, payload, envelopeMeta()),
    })
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

  /**
   * Desktops this user could target right now, with the names to offer them by.
   *
   * This is what the phone's computer picker draws. It deliberately does not feed
   * the `desktop_offline` answer a phone gets back for an intent: that answer says
   * "the computer you named is not reachable", and it reads the same whether the id
   * was never online or does not exist. A phone that wants to tell those apart has
   * this list — pushing presence already told it which computers exist.
   */
  onlineDesktops(userId: string): LiveReachableDesktop[] {
    return this.desktopGateway.listOnlineDesktops(userId)
  }

  /**
   * A phone's socket closed. Every desktop of that user is told, because only the
   * desktops know which terminals that phone had open and therefore which write
   * leases to release.
   */
  handleMobileDisconnect(userId: string, mobileClientInstanceId: string, reason: string): void {
    for (const desktop of this.onlineDesktops(userId)) {
      this.desktopGateway.sendToClientInstance({
        userId,
        clientInstanceId: desktop.clientInstanceId,
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

  /**
   * Drops the least recently published summary.
   *
   * This relies on `handleSummary` re-inserting on every write, which is what makes
   * insertion order mean "least recently updated": that is the computer a phone
   * cold-starting has least use for, as opposed to the one that has simply been
   * around the longest.
   */
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
