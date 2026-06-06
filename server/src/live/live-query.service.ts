import { Injectable } from "@nestjs/common"
import { LiveClientRegistry } from "./live-client-registry"
import type { LiveClientInstance, LiveClientPublicDto } from "./live.types"

@Injectable()
export class LiveQueryService {
  constructor(private readonly registry: LiveClientRegistry) {}

  listAdminClients(): LiveClientPublicDto[] {
    return this.registry.listAll().map((client) => toPublicDto(client, { includeUserId: true }))
  }

  listAdminUserClients(userId: string): LiveClientPublicDto[] {
    return this.registry.listByUser(userId).map((client) => toPublicDto(client, { includeUserId: true }))
  }

  listUserClients(userId: string): LiveClientPublicDto[] {
    return this.registry.listByUser(userId).map((client) => toPublicDto(client, { includeUserId: false }))
  }
}

export function toPublicDto(
  client: LiveClientInstance,
  options: { readonly includeUserId: boolean },
): LiveClientPublicDto {
  return {
    ...(options.includeUserId ? { userId: client.userId } : undefined),
    clientInstanceId: client.clientInstanceId,
    status: client.status,
    appVersion: client.appVersion,
    platform: client.platform,
    deviceName: client.deviceName,
    connectedAt: client.connectedAt,
    lastSeenAt: client.lastSeenAt,
    disconnectedAt: client.disconnectedAt,
    disconnectReason: client.disconnectReason,
  }
}
