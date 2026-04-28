import { channelForDomain } from "./runtime/event-bus"
import type { DomainEvent, EventDomain, Unsubscribe } from "./runtime/event-bus"

type RawSubscribe = (channel: string) => (listener: (payload: unknown) => void) => Unsubscribe

function isDomainEvent(
  payload: unknown,
  domain: EventDomain,
  type: string,
): payload is DomainEvent {
  if (typeof payload !== "object" || payload === null) {
    return false
  }

  const event = payload as Partial<DomainEvent>

  return event.domain === domain && event.type === type && "payload" in event
}

function createDomainEventPayloadSubscription<TPayload>(
  subscribe: RawSubscribe,
  domain: EventDomain,
  type: string,
): (listener: (payload: TPayload) => void) => Unsubscribe {
  return (listener) =>
    subscribe(channelForDomain(domain))((event) => {
      if (isDomainEvent(event, domain, type)) {
        listener(event.payload as TPayload)
      }
    })
}

function createRawPayloadSubscription<TPayload>(
  subscribe: RawSubscribe,
  channel: string,
): (listener: (payload: TPayload) => void) => Unsubscribe {
  return (listener) =>
    subscribe(channel)((payload) => {
      listener(payload as TPayload)
    })
}

export {
  createDomainEventPayloadSubscription,
  createRawPayloadSubscription,
}
