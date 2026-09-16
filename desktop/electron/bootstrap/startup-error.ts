/** Same bound the other user-visible error text gets, so a driver dump cannot fill the dialog. */
const MAX_STARTUP_DETAIL_LENGTH = 1000

/**
 * A startup failure is the one error a user cannot work around: the app is not running, so this
 * dialog is all they have to hand to support. That is why the raw text is kept rather than
 * dropped — it is framed as technical detail and bounded, and the Chinese line above it is what
 * the user is meant to read. It used to be dropped in unframed, so a driver message in English
 * read as if it were the explanation.
 */
export function formatStartupFailureDialogMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const visibleMessage = message.trim().length > 0 ? message.trim() : "未知错误"
  return `初始化时遇到错误：\n\n技术信息：${truncateStartupDetail(visibleMessage)}\n\n请查看应用日志获取更多信息。`
}

function truncateStartupDetail(value: string): string {
  return value.length > MAX_STARTUP_DETAIL_LENGTH
    ? `${value.slice(0, MAX_STARTUP_DETAIL_LENGTH)}...`
    : value
}
