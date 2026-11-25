import { Injectable } from "@nestjs/common"
import { randomBytes } from "node:crypto"

export const CHANNEL_DEBUG_TICKET_PREFIX = "sydbg_"
const DEBUG_TICKET_TTL_MS = 60_000
const MAX_STORED_TICKETS = 5000

type StoredDebugTicket = {
  readonly channelId: string
  readonly ownerId: string
  readonly expiresAtMs: number
}

export function isChannelDebugTicket(value: string): boolean {
  return value.startsWith(CHANNEL_DEBUG_TICKET_PREFIX) && value.length >= 24 && value.length <= 128
}

@Injectable()
export class ChannelDebugTicketStore {
  private readonly tickets = new Map<string, StoredDebugTicket>()

  issue(channelId: string, ownerId: string, now = Date.now()): { readonly ticket: string; readonly expiresAt: string } {
    this.pruneExpired(now)
    if (this.tickets.size >= MAX_STORED_TICKETS) {
      const oldestKey = this.tickets.keys().next().value
      if (oldestKey) this.tickets.delete(oldestKey)
    }
    const ticket = `${CHANNEL_DEBUG_TICKET_PREFIX}${randomBytes(24).toString("base64url")}`
    const expiresAtMs = now + DEBUG_TICKET_TTL_MS
    this.tickets.set(ticket, { channelId, ownerId, expiresAtMs })
    return {
      ticket,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }
  }

  consume(ticket: string, channelId: string, now = Date.now()): { readonly ownerId: string } | null {
    this.pruneExpired(now)
    const entry = this.tickets.get(ticket)
    if (!entry) return null
    if (entry.expiresAtMs < now) {
      this.tickets.delete(ticket)
      return null
    }
    if (entry.channelId !== channelId) return null
    this.tickets.delete(ticket)
    return { ownerId: entry.ownerId }
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.tickets) {
      if (entry.expiresAtMs < now) this.tickets.delete(key)
    }
  }
}
