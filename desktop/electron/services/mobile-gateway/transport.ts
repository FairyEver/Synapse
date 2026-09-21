import type {
  MobileClipboardPayload,
  MobileGitStatusPayload,
  MobileIntent,
  MobileIntentResult,
  MobileQuickPhrasesPayload,
  MobileSummaryPayload,
  MobileToolbarPayload,
  MobileTransferProgressPayload,
} from "@synapse/shared" with { "resolution-mode": "import" }

/**
 * The part of a summary the gateway produces. The desktop's own identity is
 * appended by the live connection, which is the only component that knows it.
 */
export type MobileSummaryDraft = Omit<MobileSummaryPayload, "desktopClientInstanceId" | "desktopName">

/**
 * The toolbar, minus the identity for the same reason.
 *
 * A phone filters by computer, so which computer this is has to be on the message —
 * but it is not something the gateway can know, and asking it to hold a copy would
 * be a second source of truth for an id the connection already owns.
 */
export type MobileToolbarDraft = Omit<MobileToolbarPayload, "desktopClientInstanceId">

/** The 快捷输入 sentences, minus the identity, for the same reason. */
export type MobileQuickPhrasesDraft = Omit<MobileQuickPhrasesPayload, "desktopClientInstanceId">

/** The recently copied text, minus the identity, for the same reason. */
export type MobileClipboardDraft = Omit<MobileClipboardPayload, "desktopClientInstanceId">

/**
 * 一台电脑上、一个终端当前目录的 Git 状态，减去电脑身份（同为 `MobileSummaryDraft` 的理由）。
 *
 * 它**不像**上面三条那样减去收件人：这份状态说的是「你正开着的那个终端」，
 * 所以它本来就带 `mobileClientInstanceId`，点对点发出去。
 */
export type MobileGitStatusDraft = Omit<MobileGitStatusPayload, "desktopClientInstanceId">

/**
 * Outbound side of the gateway.
 *
 * The gateway never holds the socket. It hands finished payloads to whatever
 * transport is installed, which keeps it testable without a live connection and
 * keeps identity and reconnection concerns in one place.
 */
export type MobileGatewayTransport = {
  readonly sendSummary: (draft: MobileSummaryDraft) => void
  /**
   * One terminal frame, already serialized.
   *
   * The gateway decides whether a flush fits the phone's uplink budget, and the only
   * measurement that is honest about that is the frame's own serialized size — so the
   * string it measured is the string it hands over, and the live connection splices it
   * into the envelope instead of serializing the same frame a second time. Passing the
   * object would put the decision and the send back on two different measurements, and
   * cost a second full pass over up to 8 KiB of escaped terminal text per frame.
   */
  readonly sendFrame: (mobileClientInstanceId: string, frameJson: string) => void
  readonly sendIntentResult: (mobileClientInstanceId: string, result: MobileIntentResult) => void
  /**
   * Fire-and-forget by design: progress that arrives late is worth less than the
   * next one, so nothing here waits on a send and nothing is retried.
   */
  readonly sendTransferProgress: (payload: MobileTransferProgressPayload) => void
  /**
   * The command buttons this computer offers its phones.
   *
   * A full snapshot every time, never a delta, for the reason a summary is: a phone
   * replaces what it has with what arrives, so a lost message costs nothing beyond
   * waiting for the next one.
   */
  readonly sendToolbar: (draft: MobileToolbarDraft) => void
  /**
   * The 快捷输入 sentences this computer keeps, for its phones to tap into a
   * composer.
   *
   * A separate message rather than more buttons on the one above: the two come from
   * two different desktop apps and change on two different events, and — the part
   * that matters to a phone — "this computer has no phrases" and "this computer has
   * never heard of phrases" have to stay tellable apart. A list riding on the
   * toolbar could only ever say the first.
   */
  readonly sendQuickPhrases: (draft: MobileQuickPhrasesDraft) => void
  /**
   * The text this computer has copied recently.
   *
   * A full snapshot like the two above it, and — unlike them — one whose *only*
   * meaning is recency. It is also the one message on this wire whose payload a
   * phone merges rather than replaces: the desktop keeps twenty entries and the
   * phone keeps fifty, so the two lists are deliberately not equal, and a phone
   * that treated this as the whole truth would shrink its own.
   */
  readonly sendClipboard: (draft: MobileClipboardDraft) => void
  /**
   * 终端当前目录的 Git 状态，发给正开着这个终端的那台手机。
   *
   * 与摘要分开的一条消息，理由不是字节预算而是**代价**：摘要在有输出时以 1 Hz 刷新，
   * 而这一份要跑一次 `git status` —— 骑上去等于每秒 spawn 一次 git。
   *
   * 整份快照，和上面四条一样：手机用它替换自己那份，所以丢一条只等于等下一个。
   */
  readonly sendGitStatus: (draft: MobileGitStatusDraft) => void
}

/** Inbound side: the live connection hands cloud-delivered events to the gateway. */
export type MobileIntentHandler = {
  handle(mobileClientInstanceId: string, intent: MobileIntent): Promise<void>
  /** The phone's connection dropped; its leases must not outlive it. */
  releaseClient(mobileClientInstanceId: string): Promise<void>
}
