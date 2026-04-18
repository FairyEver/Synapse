import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react"
import { toast, type ExternalToast } from "sonner"
import { Toaster } from "@/components/ui/sonner"

type AppNotificationId = string | number
type AppNotificationTone = "default" | "success" | "info" | "warning" | "destructive" | "loading"
type AppNotificationOptions = Omit<ExternalToast, "duration"> & {
  durationMs?: number
}
type AppNotificationInput = AppNotificationOptions & {
  message: ReactNode
  tone?: AppNotificationTone
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
  success: (message: ReactNode, options?: AppNotificationOptions) => AppNotificationId
  warning: (message: ReactNode, options?: AppNotificationOptions) => AppNotificationId
}

const DEFAULT_NOTIFICATION_DURATION_MS = 4500
const AppNotificationsContext = createContext<AppNotificationsContextValue | null>(null)

function buildToastOptions(
  tone: AppNotificationTone,
  options?: AppNotificationOptions,
): ExternalToast {
  const { durationMs, ...rest } = options ?? {}

  return {
    ...rest,
    duration: durationMs ?? (tone === "loading" ? undefined : DEFAULT_NOTIFICATION_DURATION_MS),
  }
}

function showToast(
  message: ReactNode,
  tone: AppNotificationTone,
  options?: AppNotificationOptions,
): AppNotificationId {
  const toastOptions = buildToastOptions(tone, options)

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

function AppNotificationsProvider({ children }: { children: ReactNode }) {
  const dismiss = useCallback((id?: AppNotificationId) => toast.dismiss(id), [])

  const notify = useCallback((input: AppNotificationInput) => {
    const { message, tone = "default", ...options } = input

    return showToast(message, tone, options)
  }, [])

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
      success,
      warning,
    }),
    [dismiss, error, info, loading, notify, success, warning],
  )

  return (
    <AppNotificationsContext.Provider value={value}>
      {children}
      <Toaster
        closeButton
        containerAriaLabel="消息提示"
        duration={DEFAULT_NOTIFICATION_DURATION_MS}
        position="bottom-center"
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
  type AppNotificationRecord,
  type AppNotificationTone,
}
