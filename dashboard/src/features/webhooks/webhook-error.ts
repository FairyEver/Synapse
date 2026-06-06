export function getWebhookErrorMessage(error: unknown, fallback = '操作失败') {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}
