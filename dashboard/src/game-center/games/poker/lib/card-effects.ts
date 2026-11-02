import type { PokerResolutionFrameView } from "@synapse/shared/game-contracts"
export function mergeCardFrames(previous: readonly PokerResolutionFrameView[], incoming: readonly PokerResolutionFrameView[], baseline: boolean) {
  const seen = new Set(previous.map(frame => frame.id)), fresh = [...new Map(incoming.map(frame => [frame.id, frame])).values()].filter(frame => !seen.has(frame.id))
  const frames = [...new Map([...previous, ...incoming].map(frame => [frame.id, frame])).values()].sort((a, b) => a.handId.localeCompare(b.handId) || a.seq - b.seq).slice(-100)
  return { frames, animate: baseline ? [] : fresh }
}
