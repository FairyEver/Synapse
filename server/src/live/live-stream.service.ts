import { Injectable } from "@nestjs/common"
import { filter, map, Observable, Subject } from "rxjs"
import type { LiveClientChangedEvent, LiveClientPublicDto } from "./live.types"

@Injectable()
export class LiveStreamService {
  private readonly events = new Subject<LiveClientChangedEvent>()

  publish(event: LiveClientChangedEvent): void {
    this.events.next({
      type: event.type,
      occurredAt: event.occurredAt,
      client: toStreamClient(event.client),
    })
  }

  adminEvents(): Observable<LiveClientChangedEvent> {
    return this.events.asObservable()
  }

  userEvents(userId: string): Observable<LiveClientChangedEvent> {
    return this.events.asObservable().pipe(
      filter((event) => event.client.userId === userId),
      map((event) => {
        const { userId: _userId, ...client } = event.client

        return {
          ...event,
          client,
        }
      }),
    )
  }
}

function toStreamClient(client: LiveClientChangedEvent["client"]): LiveClientPublicDto {
  return {
    ...(client.userId === undefined ? undefined : { userId: client.userId }),
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
