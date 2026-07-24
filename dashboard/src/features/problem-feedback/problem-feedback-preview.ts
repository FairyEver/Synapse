export function getProblemFeedbackPreview(content: string) {
  const newlineIndex = content.indexOf('\n')
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex)
  const codePoints = Array.from(firstLine)
  const truncated = codePoints.length > 120 || newlineIndex !== -1
  return `${codePoints.slice(0, 120).join('')}${truncated ? '…' : ''}`
}
