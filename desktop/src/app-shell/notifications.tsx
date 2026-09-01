import {
  createContext,
  isValidElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react"
import { toast, type ExternalToast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import {
  DEFAULT_NOTIFICATION_DURATION_MS,
  ERROR_NOTIFICATION_DURATION_MS,
} from "@/app-shell/notification-durations"

const notificationLogger = createRendererLogger("notifications")

type AppNotificationId = string | number
type AppNotificationTone = "default" | "success" | "info" | "warning" | "destructive" | "loading"
type AppNotificationOptions = Omit<ExternalToast, "duration"> & {
  durationMs?: number
}
type AppNotificationResultTone = Exclude<AppNotificationTone, "default" | "loading">
type AppNotificationInput = AppNotificationOptions & {
  message: ReactNode
  tone?: AppNotificationTone
}
type AppNotificationResult =
  | ReactNode
  | null
  | {
      message: ReactNode | null
      tone?: AppNotificationResultTone
    }
type AppNotificationResultResolver<Value> =
  | AppNotificationResult
  | ((value: Value) => AppNotificationResult)
type AppNotificationPromiseSource<Value> = Promise<Value> | (() => Promise<Value>)
type AppNotificationPromiseInput<Value> = AppNotificationOptions & {
  error?: AppNotificationResultResolver<unknown>
  loading: ReactNode
  success?: AppNotificationResultResolver<Value>
  trackingName: string
}
type AppNotificationRecord = {
  id: AppNotificationId
  createdAt: number
  dismissAt: number
  durationMs: number
  isClosing: boolean
  message: ReactNode
  tone: AppNotificationTone
}

type AppNotificationsContextValue = {
  dismiss: (id?: AppNotificationId) => AppNotificationId
  error: (message: ReactNode, options?: AppNotificationOptions) => AppNotificationId
  info: (message: ReactNode, options?: AppNotificationOptions) => AppNotificationId
  loading: (message: ReactNode, options?: AppNotificationOptions) => AppNotificationId
  notify: (input: AppNotificationInput) => AppNotificationId
  promise: <Value>(
    source: AppNotificationPromiseSource<Value>,
    input: AppNotificationPromiseInput<Value>,
  ) => Promise<Value>
  success: (message: ReactNode, options?: AppNotificationOptions) => AppNotificationId
  warning: (message: ReactNode, options?: AppNotificationOptions) => AppNotificationId
}

const AppNotificationsContext = createContext<AppNotificationsContextValue | null>(null)

function isNotificationResultObject(
  value: AppNotificationResult,
): value is { message: ReactNode | null; tone?: AppNotificationResultTone } {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && !isValidElement(value)
    && "message" in value
  )
}

function resolveNotificationResult<Value>(
  resolver: AppNotificationResultResolver<Value> | undefined,
  value: Value,
  fallbackTone: AppNotificationResultTone,
  fallbackMessage: ReactNode | null,
): { message: ReactNode | null; tone: AppNotificationResultTone } {
  const resolved =
    typeof resolver === "function"
      ? resolver(value)
      : resolver

  if (resolved === undefined) {
    return {
      message: fallbackMessage,
      tone: fallbackTone,
    }
  }

  if (isNotificationResultObject(resolved)) {
    return {
      message: resolved.message,
      tone: resolved.tone ?? fallbackTone,
    }
  }

  return {
    message: resolved,
    tone: fallbackTone,
  }
}

function resolvePromiseSource<Value>(
  source: AppNotificationPromiseSource<Value>,
): Promise<Value> {
  return typeof source === "function" ? source() : source
}

function buildToastOptions(
  tone: AppNotificationTone,
  options?: AppNotificationOptions,
): ExternalToast {
  const { durationMs, ...rest } = options ?? {}

  return {
    ...rest,
    duration: durationMs ?? defaultDurationForTone(tone),
  }
}

function defaultDurationForTone(tone: AppNotificationTone): number | undefined {
  if (tone === "loading") return undefined
  if (tone === "destructive") return ERROR_NOTIFICATION_DURATION_MS
  return DEFAULT_NOTIFICATION_DURATION_MS
}

function showToast(
  message: ReactNode,
  tone: AppNotificationTone,
  options?: AppNotificationOptions,
): AppNotificationId {
  const toastOptions = buildToastOptions(tone, options)
  const logLevel = tone === "destructive" ? "error" : tone === "warning" ? "warn" : "info"
  notificationLogger[logLevel]("notification.shown", notificationLogMetadata(message, tone))

  switch (tone) {
    case "success":
      return toast.success(message, toastOptions)
    case "info":
      return toast.info(message, toastOptions)
    case "warning":
      return toast.warning(message, toastOptions)
    case "destructive":
      return toast.error(message, toastOptions)
    case "loading":
      return toast.loading(message, toastOptions)
    default:
      return toast(message, toastOptions)
  }
}

function notificationLogMetadata(
  message: ReactNode,
  tone: AppNotificationTone,
): { readonly tone: AppNotificationTone; readonly messageLength?: number; readonly richContent?: boolean } {
  if (typeof message === "string") {
    return {
      tone,
      messageLength: message.length,
    }
  }

  return {
    tone,
    richContent: true,
  }
}

function AppNotificationsProvider({ children }: { children: ReactNode }) {
  const dismiss = useCallback((id?: AppNotificationId) => toast.dismiss(id), [])

  const notify = useCallback((input: AppNotificationInput) => {
    const { message, tone = "default", ...options } = input

    return showToast(message, tone, options)
  }, [])

  const promise = useCallback(
    async <Value,>(
      source: AppNotificationPromiseSource<Value>,
      input: AppNotificationPromiseInput<Value>,
    ) => {
      const {
        error: errorResolver,
        loading: loadingMessage,
        success: successResolver,
        trackingName,
        ...options
      } = input
      const toastId = showToast(loadingMessage, "loading", options)
      const loadingLabel = typeof loadingMessage === "string" ? loadingMessage : "(async operation)"
      const startedAt = performance.now()

      try {
        const value = await resolvePromiseSource(source)
        const elapsedMs = Math.round(performance.now() - startedAt)
        notificationLogger.info(`[async:ok] ${loadingLabel} (${elapsedMs}ms)`)
        track({
          component: "async-operation",
          name: trackingName,
          action: "complete",
          eventKey: trackingName,
          category: "operation",
          outcome: "success",
          durationMs: elapsedMs,
        })
        const result = resolveNotificationResult(successResolver, value, "success", null)

        if (result.message === null) {
          toast.dismiss(toastId)
        } else {
          showToast(result.message, result.tone, {
            ...options,
            id: toastId,
          })
        }

        return value
      } catch (error) {
        const elapsedMs = Math.round(performance.now() - startedAt)
        notificationLogger.error(`[async:fail] ${loadingLabel} (${elapsedMs}ms)`, error)
        track({
          component: "async-operation",
          name: trackingName,
          action: "complete",
          eventKey: trackingName,
          category: "operation",
          outcome: "failure",
          durationMs: elapsedMs,
        })
        const result = resolveNotificationResult(
          errorResolver,
          error,
          "destructive",
          "操作失败。",
        )

        if (result.message === null) {
          toast.dismiss(toastId)
        } else {
          showToast(result.message, result.tone, {
            ...options,
            id: toastId,
          })
        }

        throw error
      }
    },
    [],
  )

  const success = useCallback(
    (message: ReactNode, options?: AppNotificationOptions) => showToast(message, "success", options),
    [],
  )
  const info = useCallback(
    (message: ReactNode, options?: AppNotificationOptions) => showToast(message, "info", options),
    [],
  )
  const warning = useCallback(
    (message: ReactNode, options?: AppNotificationOptions) => showToast(message, "warning", options),
    [],
  )
  const error = useCallback(
    (message: ReactNode, options?: AppNotificationOptions) => showToast(message, "destructive", options),
    [],
  )
  const loading = useCallback(
    (message: ReactNode, options?: AppNotificationOptions) => showToast(message, "loading", options),
    [],
  )

  const value = useMemo<AppNotificationsContextValue>(
    () => ({
      dismiss,
      error,
      info,
      loading,
      notify,
      promise,
      success,
      warning,
    }),
    [dismiss, error, info, loading, notify, promise, success, warning],
  )

  return (
    <AppNotificationsContext.Provider value={value}>
      {children}
      <Toaster
        closeButton
        containerAriaLabel="消息提示"
        duration={DEFAULT_NOTIFICATION_DURATION_MS}
        position="top-center"
        visibleToasts={4}
      />
    </AppNotificationsContext.Provider>
  )
}

function useAppNotifications(): AppNotificationsContextValue {
  const context = useContext(AppNotificationsContext)

  if (!context) {
    throw new Error("useAppNotifications must be used within AppNotificationsProvider.")
  }

  return context
}

export {
  AppNotificationsProvider,
  type AppNotificationId,
  useAppNotifications,
  type AppNotificationInput,
  type AppNotificationOptions,
  type AppNotificationPromiseInput,
  type AppNotificationRecord,
  type AppNotificationTone,
}
