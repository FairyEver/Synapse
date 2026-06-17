function formatCreateSessionName(date: Date): string {
  const day = date.getDate()
  const hour24 = date.getHours()
  const minute = String(date.getMinutes()).padStart(2, "0")
  const period = hour24 < 12 ? "上午" : "下午"
  const hour12 = hour24 % 12 || 12
  return `${day}日${period}${hour12}:${minute}`
}

export { formatCreateSessionName }
