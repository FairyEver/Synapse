import { LineWindowTracker } from "./line-window-tracker"

/**
 * One phone watching one terminal.
 *
 * The desktop gateway owns the write lease for the duration of the attachment and
 * the phone never sees a lease id or an input revision. That is deliberate: those
 * are concurrency primitives for a client that can reliably hold state, and a
 * phone that gets suspended, roams between networks, and is killed in the
 * background is the opposite of that.
 */
export type MobileAttachment = {
  readonly mobileClientInstanceId: string
  readonly sessionId: string
  readonly tracker: LineWindowTracker
  /** The terminal produced output that has not been flushed to this phone yet. */
  dirty: boolean
  /** Flow control tripped, so the next flush must send a whole-window snapshot. */
  needsSnapshot: boolean
  leaseId: string | null
  leaseExpiresAtMs: number
  /** Set when the desktop user typed, which preempts the lease by design. */
  leasePreempted: boolean
  attachedAtMs: number
  /**
   * Emulator buffer index of the newest window read for this attachment.
   *
   * Together with the tracker's `oldestIndex` it translates a gateway line number
   * into an emulator one. Both spaces are rebased by a full resend, so the pair
   * stays valid: the client's content always aligns with the window it was last
   * sent.
   */
  emulatorWindowStart: number
  /** False until the tracker has been anchored to the emulator's index space. */
  anchored: boolean
  /** Last output watermark observed, echoed on history frames. */
  lastSeq: number
  lastSizeRevision: number
}

export function createAttachment(input: {
  readonly mobileClientInstanceId: string
  readonly sessionId: string
  readonly nowMs: number
}): MobileAttachment {
  return {
    mobileClientInstanceId: input.mobileClientInstanceId,
    sessionId: input.sessionId,
    tracker: new LineWindowTracker(),
    dirty: true,
    needsSnapshot: true,
    leaseId: null,
    leaseExpiresAtMs: 0,
    leasePreempted: false,
    attachedAtMs: input.nowMs,
    emulatorWindowStart: 0,
    anchored: false,
    lastSeq: 0,
    lastSizeRevision: 1,
  }
}

/**
 * Attachment state, indexed both ways: a phone's list of terminals, and the list
 * of phones watching any one terminal. The reverse index is what lets a single
 * terminal `data` event reach every interested phone without scanning clients.
 */
export class AttachmentRegistry {
  private readonly byClient = new Map<string, Map<string, MobileAttachment>>()
  private readonly bySession = new Map<string, Set<MobileAttachment>>()

  attach(attachment: MobileAttachment): void {
    let sessions = this.byClient.get(attachment.mobileClientInstanceId)
    if (!sessions) {
      sessions = new Map()
      this.byClient.set(attachment.mobileClientInstanceId, sessions)
    }
    const existing = sessions.get(attachment.sessionId)
    if (existing) this.detach(attachment.mobileClientInstanceId, attachment.sessionId)
    sessions.set(attachment.sessionId, attachment)
    let watchers = this.bySession.get(attachment.sessionId)
    if (!watchers) {
      watchers = new Set()
      this.bySession.set(attachment.sessionId, watchers)
    }
    watchers.add(attachment)
  }

  get(mobileClientInstanceId: string, sessionId: string): MobileAttachment | undefined {
    return this.byClient.get(mobileClientInstanceId)?.get(sessionId)
  }

  detach(mobileClientInstanceId: string, sessionId: string): boolean {
    const sessions = this.byClient.get(mobileClientInstanceId)
    const attachment = sessions?.get(sessionId)
    if (!sessions || !attachment) return false
    sessions.delete(sessionId)
    if (sessions.size === 0) this.byClient.delete(mobileClientInstanceId)
    const watchers = this.bySession.get(sessionId)
    watchers?.delete(attachment)
    if (watchers && watchers.size === 0) this.bySession.delete(sessionId)
    return true
  }

  /** Drops every attachment for a session that no longer exists. */
  detachSession(sessionId: string): MobileAttachment[] {
    const watchers = this.bySession.get(sessionId)
    if (!watchers) return []
    const removed = [...watchers]
    for (const attachment of removed) {
      this.detach(attachment.mobileClientInstanceId, sessionId)
    }
    return removed
  }

  detachClient(mobileClientInstanceId: string): MobileAttachment[] {
    const sessions = this.byClient.get(mobileClientInstanceId)
    if (!sessions) return []
    const removed = [...sessions.values()]
    for (const attachment of removed) {
      this.detach(mobileClientInstanceId, attachment.sessionId)
    }
    return removed
  }

  forSession(sessionId: string): MobileAttachment[] {
    const watchers = this.bySession.get(sessionId)
    return watchers ? [...watchers] : []
  }

  forClient(mobileClientInstanceId: string): MobileAttachment[] {
    const sessions = this.byClient.get(mobileClientInstanceId)
    return sessions ? [...sessions.values()] : []
  }

  all(): MobileAttachment[] {
    const result: MobileAttachment[] = []
    for (const sessions of this.byClient.values()) result.push(...sessions.values())
    return result
  }

  clientCount(): number {
    return this.byClient.size
  }
}
