export function todoUtcToLocal(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function todoLocalToUtc(value: string): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("请选择日期和时间")
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || todoUtcToLocal(date.toISOString()) !== value) throw new Error("日期或时间无效")
  date.setSeconds(0, 0)
  return date.toISOString()
}

export function formatTodoInstant(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone ? { timeZone } : {}) }).format(new Date(value))
}
