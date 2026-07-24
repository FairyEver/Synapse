import type { SystemNotificationInput } from "../shared/schema"

export type SystemNotifierFailureStage =
  | "adapter_init"
  | "notification_construct"
  | "notification_show"

export type SystemNotifierFailureReason =
  | "unsupported"
  | "initialization_failed"
  | "synchronous_exception"

export type SystemNotificationAdapter = {
  readonly kind: "electron" | "noop"
  show(input: SystemNotificationInput & { readonly silent: boolean }): void
}

type ElectronNotificationConstructor = {
  new(options: { title: string; body: string; silent: boolean }): {
    show(): void
  }
  isSupported(): boolean
}

export function createElectronSystemNotificationAdapter(
  Notification: ElectronNotificationConstructor,
  onFailure: (stage: SystemNotifierFailureStage, reason: SystemNotifierFailureReason) => void,
): SystemNotificationAdapter {
  try {
    if (!Notification.isSupported()) {
      onFailure("adapter_init", "unsupported")
      return createNoopSystemNotificationAdapter()
    }
  } catch {
    onFailure("adapter_init", "initialization_failed")
    return createNoopSystemNotificationAdapter()
  }

  return {
    kind: "electron",
    show(input) {
      let notification: InstanceType<ElectronNotificationConstructor>
      try {
        notification = new Notification({
          title: input.title,
          body: input.body,
          silent: input.silent,
        })
      } catch {
        onFailure("notification_construct", "synchronous_exception")
        return
      }
      try {
        notification.show()
      } catch {
        onFailure("notification_show", "synchronous_exception")
      }
    },
  }
}

export function createNoopSystemNotificationAdapter(): SystemNotificationAdapter {
  return {
    kind: "noop",
    show() {},
  }
}
