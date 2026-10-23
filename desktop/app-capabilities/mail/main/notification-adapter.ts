export interface MailNativeNotification {
  show(): void
  on(event: "click" | "close" | "failed", listener: () => void): unknown
  close?(): void
}
export interface MailNotificationInput {
  title: string; body: string; accountId: string; messageId: string | null; onClick(): Promise<void>
}
export interface MailNotificationAdapter { show(input: MailNotificationInput): void; dispose?(): void }
export function createMailNotificationAdapter(native: { isSupported(): boolean; create(options: { title: string; body: string; silent: boolean }): MailNativeNotification }, diagnostic: (code: string) => void): MailNotificationAdapter {
  const active = new Set<MailNativeNotification>()
  return {
    show(input) {
      let notification: MailNativeNotification | undefined
      try {
        if (!native.isSupported()) { diagnostic("NATIVE_UNSUPPORTED"); return }
        notification = native.create({ title: input.title, body: input.body, silent: false })
        const current = notification
        active.add(notification)
        notification.on("close", () => active.delete(current))
        notification.on("failed", () => { active.delete(current); diagnostic("NATIVE_NOTIFICATION_FAILED") })
        notification.on("click", () => { active.delete(current); void input.onClick().catch(() => diagnostic("NATIVE_CLICK_FAILED")) })
        notification.show()
      } catch { if (notification) active.delete(notification); diagnostic("NATIVE_NOTIFICATION_FAILED") }
    },
    dispose() { for (const notification of active) { try { notification.close?.() } catch { diagnostic("NATIVE_NOTIFICATION_CLOSE_FAILED") } } active.clear() },
  }
}
