import { randomUUID } from "node:crypto"
import { Injectable, Logger } from "@nestjs/common"
import { createLiveEnvelope, LIVE_MESSAGE_TYPES, type TodoChangedPayload } from "@synapse/shared"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { MobileLiveGateway } from "../mobile-live/mobile-live.gateway"

@Injectable()
export class TodoEvents {
  private readonly logger = new Logger(TodoEvents.name)
  constructor(private readonly desktops: LiveDesktopGateway, private readonly mobiles: MobileLiveGateway) {}
  publish(userId: string, payload: TodoChangedPayload): void {
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.todosChanged, payload, { id: randomUUID(), sentAt: new Date().toISOString() })
    for (const send of [() => this.desktops.broadcastToUser(userId, message), () => this.mobiles.sendToMobileClients({ userId, message })]) {
      try { send() }
      catch (error) { this.logger.warn({ userId, id: payload.id, version: payload.version, reason: error instanceof Error ? error.name : typeof error }, "Todo change broadcast failed") }
    }
  }
}
