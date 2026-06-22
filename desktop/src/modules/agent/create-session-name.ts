function formatCreateSessionName(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return `新对话 ${hour}:${minute}`
}

export { formatCreateSessionName }
