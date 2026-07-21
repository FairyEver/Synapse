export function formatDurationMs(durationMs: number): string {
  const normalizedMs = Math.max(0, Math.round(durationMs))

  if (normalizedMs < 1000) return `${normalizedMs}毫秒`

  if (normalizedMs < 60_000) {
    return `${Math.min(59, Math.round(normalizedMs / 1000))}秒`
  }

  const totalSeconds = Math.round(normalizedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return seconds > 0 ? `${minutes}分钟${seconds}秒` : `${minutes}分钟`
}
