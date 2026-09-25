/**
 * 桌面端自己发起的账号通知。
 *
 * 这张表是**唯一来源**：服务端的写入校验与桌面端的请求入参都从它派生，两侧不可能各写一份
 * 而互相漂移。它同时是一条授权边界——只列出桌面合法拥有的 source，服务端自有来源（开放 API
 * 的外部消息、终端待处理、录音转写）不在其中，桌面不得冒充。
 */
export const DESKTOP_NOTIFICATION_SOURCES = ["system-notifier", "terminal-complete"] as const

export type DesktopNotificationSource = (typeof DESKTOP_NOTIFICATION_SOURCES)[number]

/**
 * 一次桌面写入的结果。请求本身失败不在这里——它表现为抛错。
 *
 * `sent` 只表示服务端接受了这条消息，不表示任何设备已经显示它。
 */
export type DesktopNotificationOutcome = "sent" | "not_signed_in" | "offline"
