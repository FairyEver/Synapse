const numbers = new Intl.NumberFormat("zh-CN")
export const formatGameAmount = (value: number) => numbers.format(value)
export function formatGameCountdown(ms: number | null): string {
  if (ms === null) return "—"
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
