export function formatStartupFailureDialogMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const visibleMessage = message.trim().length > 0 ? message : "未知错误"
  return `初始化时遇到错误：\n\n${visibleMessage}\n\n请查看应用日志获取更多信息。`
}
