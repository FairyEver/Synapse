import type {
  MobileIntent,
  MobileIntentResult,
  MobileQuickPhrasesPayload,
  MobileSummaryPayload,
  MobileTerminalFrame,
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

/**
 * Outbound side of the gateway.
 *
 * The gateway never holds the socket. It hands finished payloads to whatever
 * transport is installed, which keeps it testable without a live connection and
 * keeps identity and reconnection concerns in one place.
 */
export type MobileGatewayTransport = {
  readonly sendSummary: (draft: MobileSummaryDraft) => void
  readonly sendFrame: (mobileClientInstanceId: string, frame: MobileTerminalFrame) => void
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
}

/** Inbound side: the live connection hands cloud-delivered events to the gateway. */
export type MobileIntentHandler = {
  handle(mobileClientInstanceId: string, intent: MobileIntent): Promise<void>
  /** The phone's connection dropped; its leases must not outlive it. */
  releaseClient(mobileClientInstanceId: string): Promise<void>
}
