/**
 * 账号通知的既有来源。桌面主进程使用 CommonJS，服务端与 renderer 使用 ESM；
 * 两种模块入口都引用这份定义，读取分类不改变各来源的写入授权。
 *
 * @type {readonly ["external", "system-notifier", "terminal-attention", "terminal-complete", "meeting-transcription", "mail"]}
 */
exports.NOTIFICATION_SOURCES = [
  "external",
  "system-notifier",
  "terminal-attention",
  "terminal-complete",
  "meeting-transcription",
  "mail",
]
