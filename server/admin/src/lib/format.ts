export function formatDate(value: string | null | undefined): string {
  if (!value) return "无"
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value)
}
