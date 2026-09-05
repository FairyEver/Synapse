import type { BrowserWindow } from "electron"

type DetachedViewWindowLogger = {
  readonly error: (message: string, metadata?: Record<string, unknown>) => void
}

type DetachedViewWindowLifecycleContext<TPayload> = {
  readonly key: string
  readonly window: BrowserWindow
  readonly payload: TPayload
}

type DetachedViewWindowOpenRequest<TPayload> = {
  readonly key: string
  readonly payload: TPayload
  readonly options: Electron.BrowserWindowConstructorOptions
  readonly load: (window: BrowserWindow, payload: TPayload) => Promise<void>
  readonly logMetadata?: (payload: TPayload) => Record<string, unknown>
  readonly preloadErrorMessage?: string
  readonly loadErrorMessage?: string
  readonly closeOnLoadError?: "close" | "destroy"
  readonly cleanupOnLoadError?: boolean
  readonly onCreated?: (context: DetachedViewWindowLifecycleContext<TPayload>) => void
  readonly onClosed?: (context: DetachedViewWindowLifecycleContext<TPayload>) => void
  readonly onRemoved?: (context: DetachedViewWindowLifecycleContext<TPayload>) => void
  readonly onReadyToShow?: (window: BrowserWindow) => void
}

type DetachedViewWindowServiceDeps = {
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly logger: DetachedViewWindowLogger
}

export function focusDetachedViewWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  if (typeof window.isVisible === "function" && !window.isVisible()) window.show()
  window.focus()
}

export function buildDetachedViewWindowUrl(baseUrl: string, params: URLSearchParams): string {
  const separator = baseUrl.includes("?") ? "&" : "?"
  return `${baseUrl}${separator}${params.toString()}`
}

export function createDetachedViewWindowService(deps: DetachedViewWindowServiceDeps) {
  const windowsByKey = new Map<string, BrowserWindow>()
  const keyByWindowId = new Map<number, string>()

  function get(key: string): BrowserWindow | null {
    const window = windowsByKey.get(key)
    if (!window || window.isDestroyed()) return null
    return window
  }

  function remove<TPayload>(
    key: string,
    payload?: TPayload,
    onRemoved?: (context: DetachedViewWindowLifecycleContext<TPayload>) => void,
  ): boolean {
    const window = windowsByKey.get(key)
    if (window) {
      keyByWindowId.delete(window.id)
    }
    const removed = windowsByKey.delete(key)
    if (removed && window && payload !== undefined) {
      onRemoved?.({ key, window, payload })
    }
    return removed
  }

  return {
    get,

    focus(key: string): boolean {
      const window = get(key)
      if (!window) return false
      focusDetachedViewWindow(window)
      return true
    },

    async open<TPayload>(
      request: DetachedViewWindowOpenRequest<TPayload>,
    ): Promise<{ readonly window: BrowserWindow; readonly created: boolean }> {
      const existing = get(request.key)
      if (existing) {
        focusDetachedViewWindow(existing)
        return { window: existing, created: false }
      }

      const window = deps.createWindow(request.options)
      windowsByKey.set(request.key, window)
      keyByWindowId.set(window.id, request.key)
      request.onCreated?.({ key: request.key, window, payload: request.payload })

      window.on("page-title-updated", (event) => {
        event.preventDefault()
      })

      if (request.preloadErrorMessage) {
        const preloadErrorMessage = request.preloadErrorMessage
        window.webContents.on("preload-error", (_event, _preloadPath, error) => {
          deps.logger.error(preloadErrorMessage, { error })
        })
      }

      if (request.onReadyToShow) {
        window.once("ready-to-show", () => {
          request.onReadyToShow?.(window)
        })
      }

      window.on("closed", () => {
        const currentKey = keyByWindowId.get(window.id) ?? request.key
        remove(currentKey, request.payload, request.onRemoved)
        request.onClosed?.({ key: currentKey, window, payload: request.payload })
      })

      try {
        await request.load(window, request.payload)
      } catch (error) {
        if (request.cleanupOnLoadError !== false) {
          remove(request.key, request.payload, request.onRemoved)
        }
        if (request.loadErrorMessage) {
          deps.logger.error(request.loadErrorMessage, {
            ...request.logMetadata?.(request.payload),
            error,
          })
        }
        if (request.cleanupOnLoadError !== false && !window.isDestroyed()) {
          if (request.closeOnLoadError === "destroy") {
            window.destroy()
          } else {
            window.close()
          }
        }
        throw error
      }

      return { window, created: true }
    },

    remove,

    close(key: string): boolean {
      const window = get(key)
      if (!window) {
        remove(key)
        return false
      }
      window.close()
      remove(key)
      return true
    },

    replaceKey(oldKey: string, newKey: string): BrowserWindow | null {
      const window = get(oldKey)
      if (!window) return null
      if (oldKey === newKey) return window
      windowsByKey.delete(oldKey)
      windowsByKey.set(newKey, window)
      keyByWindowId.set(window.id, newKey)
      return window
    },
  }
}

export type DetachedViewWindowService = ReturnType<typeof createDetachedViewWindowService>
