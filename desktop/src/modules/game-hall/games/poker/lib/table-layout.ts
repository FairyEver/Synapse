import type { PokerTableEvent } from "@synapse/shared/game-contracts"
export const TABLE_WIDTH = 1440
export const TABLE_HEIGHT = 900
export function canvasFit(width: number, height: number) {
  const scale = Math.max(0, Math.min(width / TABLE_WIDTH, height / TABLE_HEIGHT))
  return { scale, width: TABLE_WIDTH * scale, height: TABLE_HEIGHT * scale }
}
export function eventKey(event: PokerTableEvent) { return `${event.handId}:${event.seq}:${event.kind}` }
export function mergeTableEvents(previous: PokerTableEvent[], incoming: PokerTableEvent[], initial: boolean) {
  const seen = new Set(previous.map(eventKey)), fresh: PokerTableEvent[] = []
  for (const event of incoming) if (!seen.has(eventKey(event))) { seen.add(eventKey(event)); fresh.push(event) }
  return { events: [...previous, ...fresh].slice(-300), animate: initial ? [] : fresh }
}
