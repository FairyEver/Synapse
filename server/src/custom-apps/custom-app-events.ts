import { Injectable, Logger, Optional } from "@nestjs/common"
import { LIVE_MESSAGE_TYPES, createLiveEnvelope } from "@synapse/shared"
import { randomUUID } from "node:crypto"

import { LiveDesktopGateway } from "../live/live-desktop.gateway"

@Injectable()
export class CustomAppEvents {
  private readonly logger = new Logger(CustomAppEvents.name)

  constructor(
    @Optional() private readonly live?: LiveDesktopGateway,
  ) {}

  publish(userId: string, revision: number): void {
    try {
      this.live?.broadcastToUser(userId, createLiveEnvelope(
        LIVE_MESSAGE_TYPES.customAppsChanged,
        { revision },
        { id: randomUUID(), sentAt: new Date().toISOString() },
      ))
    } catch (error) {
      this.logger.warn({
        userId,
        revision,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Failed to broadcast custom app change.")
    }
  }
}
