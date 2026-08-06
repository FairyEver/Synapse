import { Injectable } from "@nestjs/common"
import type { DriveCollaborationControlMessage } from "@synapse/shared"

export type DriveCollaborationBusListener = (message: DriveCollaborationControlMessage) => void

export interface DriveCollaborationBus {
  publish(itemId: string, message: DriveCollaborationControlMessage): void
  subscribe(itemId: string, listener: DriveCollaborationBusListener): () => void
}

@Injectable()
export class LocalDriveCollaborationBus implements DriveCollaborationBus {
  private readonly listeners = new Map<string, Set<DriveCollaborationBusListener>>()

  publish(itemId: string, message: DriveCollaborationControlMessage): void {
    for (const listener of this.listeners.get(itemId) ?? []) listener(message)
  }

  subscribe(itemId: string, listener: DriveCollaborationBusListener): () => void {
    const listeners = this.listeners.get(itemId) ?? new Set<DriveCollaborationBusListener>()
    listeners.add(listener)
    this.listeners.set(itemId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(itemId)
    }
  }
}
