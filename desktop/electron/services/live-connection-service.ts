import os from "node:os"
import { app } from "electron"
import WebSocket from "ws"
import type {
  MobileIntentResult,
  MobileTransferProgressPayload,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { SynapseAccountState } from "../../src/types/account"
import type { SynapseLiveState } from "../../src/types/live"
import type { EventBus } from "../runtime/event-bus"
import type { AccountService } from "./account-service"
import type { LiveMeetingTranscriptionHandler } from "./live-meeting-transcription-handler"
import type { LiveWebhookDeliveryHandler } from "./live-webhook-delivery-handler"
import { LiveClientIdStore } from "./live-client-id-store"
import { createLiveReconnectDelay, isStableLiveConnection } from "./live-reconnect-policy"
import { createMainLogger } from "./log-store"
import type {
  MobileClipboardDraft,
  MobileIntentHandler,
  MobileQuickPhrasesDraft,
  MobileSummaryDraft,
  MobileToolbarDraft,
} from "./mobile-gateway/transport"

const logger = createMainLogger("service.live")
const defaultHeartbeatIntervalMs = 20_000
const defaultHeartbeatTimeoutMs = 45_000
const liveProtocolPromise = import("@synapse/shared")

/**
 * How much unsent data may pile up in the socket's own buffer before this side stops
 * adding to it.
 *
 * `ws` buffers without limit, so a link that has stopped draining turns every frame
 * the gateway produces into memory held by the main process — and the gateway produces
 * them whether or not anyone is reading, because a terminal is printing. Dropping is
 * safe by protocol: a frame the phone never received is covered by the next one, which
 * carries the state that matters, and a summary is re-sent on the next tick.
 *
 * Half a megabyte, against an uplink budget of 64 KiB per second per phone and frames
 * of at most 8 KiB, is several seconds of backlog. A phone that far behind is not
 * looking at this screen any more; the bound is what keeps a stalled socket from
 * becoming a memory leak rather than a number anyone is meant to tune.
 */
export const MAX_SOCKET_BUFFERED_BYTES = 512 * 1024

/**
 * The marker standing in for a terminal frame that is already serialized.
 *
 * `sendMobileFrame` receives the frame's JSON rather than the frame, so that the bytes
 * the gateway charged the uplink budget are the bytes that go out. The envelope is
 * still built by `createLiveEnvelope` and serialized by `JSON.stringify` — the marker
 * is what that string is then spliced around, rather than a second full pass over the
 * frame. It is plain printable ASCII, so `JSON.stringify` emits it verbatim and it can
 * be found in the result — and because the frame is the payload's last field, the last
 * occurrence is the one to replace, whatever an earlier field happens to contain.
 */
const RAW_FRAME_MARKER = "__synapse_raw_mobile_frame__"

type LiveSocket = Pick<WebSocket, "on" | "send" | "close" | "readyState" | "bufferedAmount">

type LiveConnectionServiceDeps = {
  readonly accountService: AccountService
  readonly clientIdStore?: Pick<LiveClientIdStore, "getOrCreate" | "reissue">
  readonly createSocket?: (url: string, options: { headers: Record<string, string> }) => LiveSocket
  readonly setTimeout?: (callback: () => void, delay: number) => NodeJS.Timeout
  readonly clearTimeout?: (timer: NodeJS.Timeout) => void
  readonly reconnectDelay?: (attempt: number) => number
  readonly now?: () => Date
  readonly appVersion?: () => string
  readonly platform?: () => string
  readonly deviceName?: () => string
  readonly webhookDeliveryHandler?: Pick<LiveWebhookDeliveryHandler, "handle">
  readonly meetingTranscriptionHandler?: Pick<LiveMeetingTranscriptionHandler, "handle">
}

export class LiveConnectionService {
  private readonly accountService: AccountService
  private readonly clientIdStore: Pick<LiveClientIdStore, "getOrCreate" | "reissue">
  private readonly createSocket: (url: string, options: { headers: Record<string, string> }) => LiveSocket
  private readonly setTimer: (callback: () => void, delay: number) => NodeJS.Timeout
  private readonly clearTimer: (timer: NodeJS.Timeout) => void
  private readonly reconnectDelay: (attempt: number) => number
  private readonly now: () => Date
  private readonly appVersion: () => string
  private readonly platform: () => string
  private readonly deviceName: () => string
  private webhookDeliveryHandler: Pick<LiveWebhookDeliveryHandler, "handle"> | null
  private meetingTranscriptionHandler: Pick<LiveMeetingTranscriptionHandler, "handle"> | null
  private mobileIntentHandler: MobileIntentHandler | null = null
  private sharedProtocol: Awaited<typeof liveProtocolPromise> | null = null
  private eventBus: EventBus | null = null
  private socket: LiveSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private serverTimeoutTimer: NodeJS.Timeout | null = null
  private connectInFlight: Promise<void> | null = null
  private accountRefreshInFlight = false
  private heartbeatTimeoutMs = defaultHeartbeatTimeoutMs
  /**
   * Captured rather than imported: `@synapse/shared` is loaded asynchronously in
   * this process, and a socket close is handled synchronously. Every socket is
   * made inside `connect`, which has already awaited the protocol, so the value
   * is in place before any close can arrive.
   */
  private clientInstanceIdConflictCloseCode = -1
  private reconnectAttempt = 0
  /**
   * When the current connection was welcomed, in the same clock as `now`.
   *
   * Held so the attempt counter is only cleared by a connection that survived — see
   * `isStableLiveConnection`. `null` means this socket never got that far.
   */
  private connectedAtMs: number | null = null
  private connectionGeneration = 0
  private closedIntentionally = false
  private authenticatedAccountUserId: string | null = null
  private state: SynapseLiveState = {
    status: "unauthenticated",
    clientInstanceId: null,
    connectedAt: null,
    lastSeenAt: null,
    lastError: null,
  }

  constructor(deps: LiveConnectionServiceDeps) {
    this.accountService = deps.accountService
    this.clientIdStore = deps.clientIdStore ?? new LiveClientIdStore()
    this.createSocket = deps.createSocket ?? ((url, options) => new WebSocket(url, options))
    this.setTimer = deps.setTimeout ?? setTimeout
    this.clearTimer = deps.clearTimeout ?? clearTimeout
    this.reconnectDelay = deps.reconnectDelay ?? ((attempt) => createLiveReconnectDelay({ attempt }))
    this.now = deps.now ?? (() => new Date())
    this.appVersion = deps.appVersion ?? (() => app.getVersion())
    this.platform = deps.platform ?? (() => `${process.platform}-${process.arch}`)
    this.deviceName = deps.deviceName ?? (() => os.hostname())
    this.webhookDeliveryHandler = deps.webhookDeliveryHandler ?? null
    this.meetingTranscriptionHandler = deps.meetingTranscriptionHandler ?? null
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  setWebhookDeliveryHandler(handler: Pick<LiveWebhookDeliveryHandler, "handle">): void {
    this.webhookDeliveryHandler = handler
  }

  setMeetingTranscriptionHandler(handler: Pick<LiveMeetingTranscriptionHandler, "handle">): void {
    this.meetingTranscriptionHandler = handler
  }

  setMobileIntentHandler(handler: MobileIntentHandler): void {
    this.mobileIntentHandler = handler
  }

  getState(): SynapseLiveState {
    return this.state
  }

  handleAccountState(state: SynapseAccountState): void {
    if (state.status !== "authenticated") {
      this.authenticatedAccountUserId = null
      this.closeSocket("unauthenticated")
      this.setState({
        status: "unauthenticated",
        clientInstanceId: null,
        connectedAt: null,
        lastSeenAt: null,
        lastError: null,
      })
      return
    }

    const nextUserId = state.profile.user.id
    const isSameAccount = this.authenticatedAccountUserId === nextUserId
    this.authenticatedAccountUserId = nextUserId
    if (isSameAccount && (
      this.socket
      || this.reconnectTimer
      || this.connectInFlight
      || this.accountRefreshInFlight
      || this.state.status === "connected"
    )) {
      return
    }

    this.startConnect()
  }

  async retryNow(): Promise<SynapseLiveState> {
    const accountState = this.accountService.getState()
    if (accountState.status !== "authenticated" || this.state.status === "connected") {
      return this.state
    }
    if (this.connectInFlight) {
      await this.connectInFlight
      return this.state
    }
    if (this.accountRefreshInFlight) {
      return this.state
    }

    this.closeSocket("manual_retry")
    this.closedIntentionally = false
    await this.startConnect()
    return this.state
  }

  async connect(): Promise<void> {
    const generation = this.nextConnectionGeneration()
    let token = this.accountService.getAccessTokenForLive()
    if (!token) {
      await this.accountService.refreshFromStorage({ reason: "live-auth-failure" })
      if (!this.isCurrentGeneration(generation)) return
      token = this.accountService.getAccessTokenForLive()
      if (!token) {
        if (this.keepReconnectingForOfflineAccount()) return
        this.closeSocket("unauthenticated")
        this.setState({
          ...this.state,
          status: "unauthenticated",
          lastError: "账号未登录",
        })
        return
      }
    }

    const clientInstanceId = await this.clientIdStore.getOrCreate()
    if (!this.isCurrentGeneration(generation)) return

    const { LIVE_DESKTOP_CLOSE_CODES, buildLiveDesktopSocketUrl } = await liveProtocolPromise
    if (!this.isCurrentGeneration(generation)) return
    this.clientInstanceIdConflictCloseCode = LIVE_DESKTOP_CLOSE_CODES.clientInstanceIdConflict
    const socketUrl = buildLiveDesktopSocketUrl(this.accountService.getApiBaseUrlForLive())
    this.closeCurrentSocket("reconnect")
    this.closedIntentionally = false
    this.setState({
      ...this.state,
      status: "reconnecting",
      clientInstanceId,
      connectedAt: null,
      lastSeenAt: null,
      lastError: null,
    })

    const socket = this.createSocket(socketUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    this.socket = socket

    socket.on("open", () => {
      void this.sendHello(socket, clientInstanceId).catch((error: unknown) => {
        this.logLiveMessageError(error)
      })
    })

    socket.on("message", (payload: unknown) => {
      void this.handleMessage(String(payload), clientInstanceId).catch((error: unknown) => {
        this.logLiveMessageError(error)
      })
    })

    socket.on("close", (code?: number) => {
      if (this.socket !== socket) return
      // The cloud turned this connection away rather than accepting it: the id
      // this installation registers under belongs to another computer, which a
      // copied or restored app data directory can bring along. Reconnecting with
      // it would be refused the same way, so a fresh id is minted first — the one
      // thing only this side can do about it.
      if (code === this.clientInstanceIdConflictCloseCode) {
        void this.replaceClientInstanceId()
        return
      }
      this.scheduleReconnect("连接已断开")
    })

    socket.on("error", (error: unknown) => {
      logger.warn("Live socket error.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
      if (this.socket === socket && isAuthHandshakeError(error)) {
        this.refreshAfterAuthFailure()
        return
      }
      if (this.socket === socket) {
        this.scheduleReconnect("连接失败")
      }
    })
  }

  close(): void {
    this.closeSocket("closed")
    this.setState({
      ...this.state,
      status: "disconnected",
      lastError: null,
    })
  }

  private async handleMessage(payload: string, clientInstanceId: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      logger.warn("Live socket message ignored.", { messageType: "invalid_json" })
      return
    }

    const { LIVE_MESSAGE_TYPES, isLiveDesktopServerMessage } = await liveProtocolPromise
    if (!isLiveDesktopServerMessage(parsed)) {
      const messageType = parsed && typeof parsed === "object" && "type" in parsed
        ? (parsed as { readonly type?: unknown }).type
        : typeof parsed
      logger.warn("Live socket message ignored.", {
        messageType: typeof messageType === "string" ? messageType : "malformed",
      })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.welcome) {
      const welcome = parsed.payload
      const seenAt = this.now().toISOString()
      const intervalMs = welcome.heartbeatIntervalMs > 0
        ? welcome.heartbeatIntervalMs
        : defaultHeartbeatIntervalMs
      this.heartbeatTimeoutMs = welcome.heartbeatTimeoutMs > 0
        ? welcome.heartbeatTimeoutMs
        : defaultHeartbeatTimeoutMs
      this.connectedAtMs = this.now().getTime()
      this.startHeartbeat(intervalMs)
      this.startServerTimeout(this.heartbeatTimeoutMs)
      this.setState({
        status: "connected",
        clientInstanceId,
        connectedAt: seenAt,
        lastSeenAt: seenAt,
        lastError: null,
      })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.pong) {
      this.startServerTimeout(this.heartbeatTimeoutMs)
      this.setState({
        ...this.state,
        status: "connected",
        lastSeenAt: this.now().toISOString(),
        lastError: null,
      })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived) {
      this.startServerTimeout(this.heartbeatTimeoutMs)
      await this.acknowledgeWebhookDelivery(parsed.payload.deliveryId)
      if (!this.webhookDeliveryHandler) {
        logger.warn("Live webhook delivery ignored.", {
          messageType: parsed.type,
          reason: "missing_handler",
        })
        return
      }
      void this.webhookDeliveryHandler.handle(parsed.payload).catch((error: unknown) => {
        logger.warn("Live webhook delivery handler failed.", {
          messageType: parsed.type,
          ...this.liveErrorMetadata(error),
        })
      })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.mobileIntent) {
      this.startServerTimeout(this.heartbeatTimeoutMs)
      const payload = parsed.payload
      // The cloud routes per device, but a desktop must never act on an intent
      // addressed to a different one.
      if (payload.desktopClientInstanceId !== clientInstanceId) {
        logger.warn("Live mobile intent ignored.", { reason: "desktop_mismatch" })
        return
      }
      if (!this.mobileIntentHandler) {
        logger.warn("Live mobile intent ignored.", { reason: "missing_handler" })
        return
      }
      void this.mobileIntentHandler.handle(payload.mobileClientInstanceId, payload.intent)
        .catch((error: unknown) => {
          logger.warn("Live mobile intent handler failed.", this.liveErrorMetadata(error))
        })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.meetingTranscriptionCompleted) {
      this.startServerTimeout(this.heartbeatTimeoutMs)
      void this.meetingTranscriptionHandler?.handle(parsed.payload).catch((error: unknown) => {
        logger.warn("Live meeting transcription handler failed.", this.liveErrorMetadata(error))
      })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.mobileDetached) {
      this.startServerTimeout(this.heartbeatTimeoutMs)
      // A phone that vanished must not keep holding a terminal's write lease.
      void this.mobileIntentHandler?.releaseClient(parsed.payload.mobileClientInstanceId)
        .catch((error: unknown) => {
          logger.warn("Live mobile client release failed.", this.liveErrorMetadata(error))
        })
    }
  }

  /* ------------------------------------------------------------------ *
   * Mobile terminal relay
   * ------------------------------------------------------------------ */

  async sendMobileSummary(draft: MobileSummaryDraft): Promise<void> {
    // Without an identity the cloud cannot tell which desktop a summary belongs to.
    const clientInstanceId = this.state.clientInstanceId
    if (!clientInstanceId) return
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    this.sendLiveEnvelope(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileSummary, {
      desktopClientInstanceId: clientInstanceId,
      desktopName: this.deviceName(),
      ...draft,
    }, this.envelopeMetadata()))
  }

  /**
   * The command buttons this computer offers its phones.
   *
   * Drops the message without an identity, like a summary: a phone keys the list by
   * which computer sent it, so one that cannot say would be filed under nothing and
   * overwrite another computer's buttons.
   */
  async sendMobileToolbar(draft: MobileToolbarDraft): Promise<void> {
    const clientInstanceId = this.state.clientInstanceId
    if (!clientInstanceId) return
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    this.sendLiveEnvelope(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileToolbar, {
      desktopClientInstanceId: clientInstanceId,
      ...draft,
    }, this.envelopeMetadata()))
  }

  /**
   * The 快捷输入 sentences this computer keeps, for its phones.
   *
   * Drops the message without an identity, exactly as the toolbar does and for the
   * same reason: a phone files a list under the computer that sent it, so one that
   * cannot say which it is would land under nothing and overwrite another machine's
   * sentences.
   */
  async sendMobileQuickPhrases(draft: MobileQuickPhrasesDraft): Promise<void> {
    const clientInstanceId = this.state.clientInstanceId
    if (!clientInstanceId) return
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    this.sendLiveEnvelope(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileQuickPhrases, {
      desktopClientInstanceId: clientInstanceId,
      ...draft,
    }, this.envelopeMetadata()))
  }

  async sendMobileClipboard(draft: MobileClipboardDraft): Promise<void> {
    const clientInstanceId = this.state.clientInstanceId
    if (!clientInstanceId) return
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    this.sendLiveEnvelope(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileClipboard, {
      desktopClientInstanceId: clientInstanceId,
      ...draft,
    }, this.envelopeMetadata()))
  }

  /**
   * One terminal frame, already serialized by the gateway.
   *
   * `frameJson` is the string the gateway measured against the phone's uplink budget,
   * so it is sent as it stands — spliced into the envelope instead of being handed back
   * to `JSON.stringify` inside it. See `sendLiveEnvelopeWithRawFrame`.
   */
  async sendMobileFrame(mobileClientInstanceId: string, frameJson: string): Promise<void> {
    const clientInstanceId = this.state.clientInstanceId
    if (!clientInstanceId) return
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    const metadata = this.envelopeMetadata()
    this.sendLiveEnvelopeWithRawFrame(
      (frame) => createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileFrame, {
        desktopClientInstanceId: clientInstanceId,
        mobileClientInstanceId,
        frame,
      }, metadata),
      frameJson,
    )
  }

  async sendMobileIntentResult(
    mobileClientInstanceId: string,
    result: MobileIntentResult,
  ): Promise<void> {
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    this.sendLiveEnvelope(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileIntentResult, {
      mobileClientInstanceId,
      result,
    }, this.envelopeMetadata()))
  }

  async sendMobileTransferProgress(payload: MobileTransferProgressPayload): Promise<void> {
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await this.getProtocol()
    this.sendLiveEnvelope(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileTransferProgress, payload, this.envelopeMetadata()))
  }

  private async getProtocol(): Promise<Awaited<typeof liveProtocolPromise>> {
    if (!this.sharedProtocol) this.sharedProtocol = await liveProtocolPromise
    return this.sharedProtocol
  }

  private envelopeMetadata(): { id: string; sentAt: string } {
    return { id: this.createMessageId(), sentAt: this.now().toISOString() }
  }

  private sendLiveEnvelope(envelope: unknown): void {
    this.sendSerialized(JSON.stringify(envelope))
  }

  /**
   * Sends an envelope whose `frame` field is already JSON, without serializing the
   * frame a second time.
   *
   * The frame arrives as a string precisely because the gateway charged the phone's
   * uplink budget for it, and charging one representation while sending another is how
   * the two drift apart. `createLiveEnvelope` and `JSON.stringify` still build every
   * other byte of the message, so the envelope's shape and escaping stay theirs; the
   * marker is the one place the frame's own JSON is spliced in. Both the marker and the
   * spliced JSON are text `JSON.stringify` emitted, so what goes on the wire is what
   * serializing the same envelope with the frame in it would have produced.
   */
  private sendLiveEnvelopeWithRawFrame(
    buildEnvelope: (frame: unknown) => unknown,
    frameJson: string,
  ): void {
    const marker = `"${RAW_FRAME_MARKER}"`
    const serialized = JSON.stringify(buildEnvelope(RAW_FRAME_MARKER))
    // Last occurrence, not first: the frame is the payload's last field, so anything
    // earlier in the message that happened to carry the same text — a client instance
    // id is only bounded by its length — cannot be mistaken for it.
    const at = serialized.lastIndexOf(marker)
    if (at < 0) {
      // Unreachable while the marker is plain ASCII and the frame is the payload's last
      // field. Rebuilding the frame from its own JSON is the honest degradation, and it
      // is the same message: a phone that received the marker itself would read a
      // malformed frame, and losing every frame would look like a dead terminal.
      logger.warn("Live mobile frame could not be spliced and was serialized again.", {
        reason: "marker_missing",
      })
      this.sendLiveEnvelope(buildEnvelope(JSON.parse(frameJson) as unknown))
      return
    }
    this.sendSerialized(serialized.slice(0, at) + frameJson + serialized.slice(at + marker.length))
  }

  /**
   * The one place a message reaches the socket, so the one place the socket's own
   * backlog is checked.
   *
   * Over the limit the message is dropped rather than queued behind it, and the drop is
   * logged: on a link that is not draining, waiting only moves the growth from this
   * process's heap into a queue the phone will never read. The heartbeat does not go
   * through here — it is a few dozen bytes, and losing it is what would tear down a
   * connection that might still recover.
   */
  private sendSerialized(payload: string): void {
    const socket = this.socket
    if (socket?.readyState !== WebSocket.OPEN) return
    const buffered = socket.bufferedAmount
    if (buffered > MAX_SOCKET_BUFFERED_BYTES) {
      logger.warn("Live outbound message dropped: the socket is backed up.", {
        bufferedBytes: buffered,
        limitBytes: MAX_SOCKET_BUFFERED_BYTES,
      })
      return
    }
    try {
      socket.send(payload)
    } catch (error) {
      logger.warn("Live outbound message failed.", this.liveErrorMetadata(error))
    }
  }

  private async acknowledgeWebhookDelivery(deliveryId: string): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await liveProtocolPromise
    if (this.socket?.readyState !== WebSocket.OPEN) return
    const sentAt = this.now().toISOString()
    try {
      this.socket.send(JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.webhookDeliveryAck, {
        deliveryId,
      }, { id: this.createMessageId(), sentAt })))
    } catch (error) {
      logger.warn("Live webhook delivery acknowledgement failed.", {
        deliveryId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat()
    this.heartbeatTimer = this.setTimer(() => {
      this.heartbeatTimer = null
      void this.sendHeartbeat(intervalMs).catch((error: unknown) => {
        this.logLiveMessageError(error)
      })
    }, intervalMs)
  }

  private startServerTimeout(timeoutMs: number): void {
    const socket = this.socket
    this.clearServerTimeout()
    this.serverTimeoutTimer = this.setTimer(() => {
      this.serverTimeoutTimer = null
      if (socket && this.socket !== socket) return
      this.handleServerTimeout(socket)
    }, timeoutMs)
  }

  private async sendHello(socket: LiveSocket, clientInstanceId: string): Promise<void> {
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await liveProtocolPromise
    if (this.socket !== socket) {
      return
    }

    const sentAt = this.now().toISOString()
    socket.send(JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.hello, {
      clientInstanceId,
      appVersion: this.appVersion(),
      platform: this.platform(),
      deviceName: this.deviceName(),
    }, { id: this.createMessageId(), sentAt })))
  }

  private async sendHeartbeat(intervalMs: number): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return
    }

    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await liveProtocolPromise
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return
    }

    const sentAt = this.now().toISOString()
    this.socket.send(JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.ping, {
      sentAt,
    }, { id: this.createMessageId(), sentAt })))
    this.startHeartbeat(intervalMs)
  }

  /**
   * Takes a new client instance id after the cloud refused the one in hand.
   *
   * A fresh id is the one thing only this side can do about the refusal, and it is
   * settled the moment the id is replaced — but the reconnection still goes through the
   * ordinary backoff rather than starting at once. Nothing here can promise the *next*
   * refusal is about the id: a relay that turns away whatever it was just handed would
   * otherwise be met with connections as fast as they can be built, which is a loop
   * with no delay in it at all. The attempt counter is deliberately not cleared, for
   * the same reason `welcome` no longer clears it — that a connection was refused is a
   * fact about the connection, not about the id it carried.
   */
  private async replaceClientInstanceId(): Promise<void> {
    logger.warn("Live client instance id refused; reconnecting under a new one.", {
      closeCode: this.clientInstanceIdConflictCloseCode,
    })
    try {
      await this.clientIdStore.reissue()
    } catch (error) {
      // The next connection is refused again if this fails, so it falls back to
      // the ordinary reconnect loop rather than giving up.
      logger.warn("Client instance id reissue failed.", this.liveErrorMetadata(error))
    }

    // The generic sentence a dropped connection already produces, rather than a new one
    // for this case: the reason reaches the settings panel, and what the user needs to
    // know is that the computer is offline for a moment. Which ended it is in the log
    // line above.
    this.scheduleReconnect("连接已断开")
  }

  private scheduleReconnect(error: string, options: { readonly allowUnauthenticatedState?: boolean } = {}): void {
    if (
      this.closedIntentionally
      || (this.state.status === "unauthenticated" && !options.allowUnauthenticatedState)
    ) {
      return
    }

    this.socket = null
    this.clearHeartbeat()
    this.clearServerTimeout()
    // Backoff is forgiven only by a connection that lasted, and forgiving it is what
    // makes an ordinary drop reconnect promptly instead of inheriting the delay of some
    // failure an hour ago.
    if (this.connectedAtMs !== null) {
      if (isStableLiveConnection(this.now().getTime() - this.connectedAtMs)) {
        this.reconnectAttempt = 0
      }
      this.connectedAtMs = null
    }
    const delay = this.reconnectDelay(this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.setState({
      ...this.state,
      status: "reconnecting",
      lastError: error,
    })
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null
      this.startConnect()
    }, delay)
  }

  private startConnect(): Promise<void> {
    if (this.connectInFlight) return this.connectInFlight

    const generation = this.connectionGeneration + 1
    const attempt = this.connect()
      .catch((error: unknown) => {
        this.handleConnectStartupFailure(error, generation)
      })
      .finally(() => {
        if (this.connectInFlight === attempt) {
          this.connectInFlight = null
        }
      })
    this.connectInFlight = attempt
    return attempt
  }

  private handleConnectStartupFailure(error: unknown, generation: number): void {
    if (!this.isCurrentGeneration(generation)) return
    logger.warn("Live connection startup failed.", {
      ...this.liveErrorMetadata(error),
    })
    const socket = this.socket
    this.socket = null
    this.clearHeartbeat()
    this.clearServerTimeout()
    if (socket) socket.close(1000, "connect_failed")
    this.closedIntentionally = false
    this.scheduleReconnect("连接失败", { allowUnauthenticatedState: true })
  }

  private closeSocket(reason: string): void {
    this.nextConnectionGeneration()
    this.closeCurrentSocket(reason)
  }

  private closeCurrentSocket(reason: string): void {
    this.closedIntentionally = true
    // The connection this timestamp belongs to ends here, and it must not be credited
    // to whatever socket comes next.
    this.connectedAtMs = null
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearHeartbeat()
    this.clearServerTimeout()
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.close(1000, reason)
    }
  }

  private handleServerTimeout(socket: LiveSocket | null): void {
    if (this.closedIntentionally || this.state.status === "unauthenticated") {
      return
    }
    if (socket && this.socket !== socket) {
      return
    }

    const currentSocket = this.socket
    this.socket = null
    this.clearHeartbeat()
    if (currentSocket) {
      currentSocket.close(1000, "heartbeat_timeout")
    }
    this.scheduleReconnect("连接超时")
  }

  private refreshAfterAuthFailure(): void {
    if (this.accountRefreshInFlight) return
    this.accountRefreshInFlight = true

    this.socket = null
    this.clearHeartbeat()
    // Same reason as `closeCurrentSocket`: this connection is over, and the credential
    // it was made with is gone, so nothing about its lifetime carries over.
    this.connectedAtMs = null
    const generation = this.nextConnectionGeneration()
    this.setState({
      ...this.state,
      status: "reconnecting",
      lastError: "登录已过期",
    })

    void this.accountService.refreshFromStorage({ reason: "live-auth-failure" })
      .then(() => {
        if (!this.isCurrentGeneration(generation)) return
        if (!this.accountService.getAccessTokenForLive()) {
          if (this.keepReconnectingForOfflineAccount()) return
          this.closeSocket("unauthenticated")
          this.setState({
            ...this.state,
            status: "unauthenticated",
            lastError: "账号未登录",
          })
          return
        }
        this.startConnect()
      })
      .catch((error: unknown) => {
        logger.warn("Live auth refresh failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
        if (!this.isCurrentGeneration(generation)) return
        if (this.keepReconnectingForOfflineAccount()) return
        this.closeSocket("unauthenticated")
        this.setState({
          ...this.state,
          status: "unauthenticated",
          lastError: "账号未登录",
        })
      })
      .finally(() => {
        this.accountRefreshInFlight = false
      })
  }

  private keepReconnectingForOfflineAccount(): boolean {
    const accountState = this.accountService.getState()
    if (
      accountState.status !== "authenticated" ||
      accountState.connectivity !== "offline"
    ) {
      return false
    }

    this.setState({
      ...this.state,
      status: "reconnecting",
      lastError: "网络不可用",
    })
    return true
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.clearTimer(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearServerTimeout(): void {
    if (this.serverTimeoutTimer) {
      this.clearTimer(this.serverTimeoutTimer)
      this.serverTimeoutTimer = null
    }
  }

  private setState(nextState: SynapseLiveState): void {
    this.state = nextState
    this.eventBus?.emit({
      domain: "live",
      type: "live.stateChanged",
      payload: { state: nextState },
      timestamp: this.now().toISOString(),
    })
  }

  private nextConnectionGeneration(): number {
    this.connectionGeneration += 1
    return this.connectionGeneration
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.connectionGeneration === generation
  }

  private createMessageId(): string {
    return `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }

  private logLiveMessageError(error: unknown): void {
    logger.warn("Live socket message handling failed.", {
      ...this.liveErrorMetadata(error),
    })
  }

  private liveErrorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
    const message = error instanceof Error ? error.message : String(error)
    return {
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: message.length,
    }
  }
}

function isAuthHandshakeError(error: unknown): boolean {
  const statusCode = typeof error === "object" && error
    ? (error as { readonly statusCode?: unknown }).statusCode
    : undefined
  if (statusCode === 401 || statusCode === 403) {
    return true
  }

  const message = error instanceof Error ? error.message : ""
  return /\b(?:401|403)\b/u.test(message)
}
