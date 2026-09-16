import type {
  MobileIntent,
  MobileIntentResult,
  MobileSummaryPayload,
  MobileTerminalFrame,
} from "@synapse/shared" with { "resolution-mode": "import" }

/**
 * The part of a summary the gateway produces. The desktop's own identity is
 * appended by the live connection, which is the only component that knows it.
 */
export type MobileSummaryDraft = Omit<MobileSummaryPayload, "desktopClientInstanceId" | "desktopName">

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
}

/** Inbound side: the live connection hands cloud-delivered events to the gateway. */
export type MobileIntentHandler = {
  handle(mobileClientInstanceId: string, intent: MobileIntent): Promise<void>
  /** The phone's connection dropped; its leases must not outlive it. */
  releaseClient(mobileClientInstanceId: string): Promise<void>
}
