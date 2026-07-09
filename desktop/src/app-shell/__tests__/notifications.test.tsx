/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ToasterProps } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

const toastFns = vi.hoisted(() => ({
  base: vi.fn(() => "toast-base"),
  dismiss: vi.fn(),
  error: vi.fn(() => "toast-error"),
  info: vi.fn(() => "toast-info"),
  loading: vi.fn(() => "toast-loading"),
  success: vi.fn(() => "toast-success"),
  warning: vi.fn(() => "toast-warning"),
}))

const toaster = vi.hoisted(() => vi.fn((_props: ToasterProps) => null))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/components/ui/sonner", () => ({
  Toaster: toaster,
}))

vi.mock("sonner", () => ({
  toast: Object.assign(toastFns.base, {
    dismiss: toastFns.dismiss,
    error: toastFns.error,
    info: toastFns.info,
    loading: toastFns.loading,
    success: toastFns.success,
    warning: toastFns.warning,
  }),
}))

import { AppNotificationsProvider, useAppNotifications } from "../notifications"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  toaster.mockClear()
  for (const fn of Object.values(rendererLogger)) fn.mockClear()
  for (const fn of Object.values(toastFns)) fn.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("AppNotificationsProvider", () => {
  it("renders global toasts at the top center with a shorter duration", () => {
    renderNotificationsHarness()

    expect(toaster).toHaveBeenCalled()
    expect(toaster.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      duration: 1000,
      position: "top-center",
    }))
  })

  it("uses sanitized fallback copy for async failures without a custom error resolver", async () => {
    renderNotificationsHarness()

    await act(async () => {
      buttonByText(document.body, "Run").click()
      await flush()
    })

    expect(toastFns.error).toHaveBeenCalledWith("操作失败。", expect.objectContaining({
      id: "toast-loading",
    }))
    expect(JSON.stringify(toastFns.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(toastFns.error.mock.calls)).not.toContain("/private/repo")
    expect(JSON.stringify(toastFns.error.mock.calls)).not.toContain("prompt body")
  })

  it("logs notification copy with metadata instead of raw message text", async () => {
    renderNotificationsHarness(<SensitiveNotificationAction />)

    await act(async () => {
      buttonByText(document.body, "Show").click()
      await flush()
    })

    const logged = JSON.stringify([
      rendererLogger.error.mock.calls,
      rendererLogger.info.mock.calls,
      rendererLogger.warn.mock.calls,
    ])
    expect(logged).not.toContain("sk-secret")
    expect(logged).not.toContain("/private/repo")
    expect(logged).not.toContain("prompt body")
    expect(rendererLogger.error).toHaveBeenCalledWith("notification.shown", expect.objectContaining({
      messageLength: "token=sk-secret /private/repo prompt body".length,
      tone: "destructive",
    }))
  })

  it("keeps error notifications visible longer by default", async () => {
    renderNotificationsHarness(<SensitiveNotificationAction />)

    await act(async () => {
      buttonByText(document.body, "Show").click()
      await flush()
    })

    expect(toastFns.error).toHaveBeenCalledWith("token=sk-secret /private/repo prompt body", expect.objectContaining({
      duration: 5000,
    }))
  })

  it("lets callers override the default error notification duration", async () => {
    renderNotificationsHarness(<CustomErrorDurationAction />)

    await act(async () => {
      buttonByText(document.body, "Show custom").click()
      await flush()
    })

    expect(toastFns.error).toHaveBeenCalledWith("custom duration", expect.objectContaining({
      duration: 7000,
    }))
  })
})

function renderNotificationsHarness(children: ReactNode = <FailingAction />): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(
      <AppNotificationsProvider>
        {children}
      </AppNotificationsProvider>,
    )
  })
}

function FailingAction() {
  const { promise } = useAppNotifications()
  return (
    <button
      type="button"
      onClick={() => {
        void promise(Promise.reject(new Error("token=sk-secret /private/repo prompt body")), {
          loading: "运行中",
        }).catch(() => undefined)
      }}
    >
      Run
    </button>
  )
}

function SensitiveNotificationAction() {
  const { error } = useAppNotifications()
  return (
    <button
      type="button"
      onClick={() => {
        error("token=sk-secret /private/repo prompt body")
      }}
    >
      Show
    </button>
  )
}

function CustomErrorDurationAction() {
  const { error } = useAppNotifications()
  return (
    <button
      type="button"
      onClick={() => {
        error("custom duration", { durationMs: 7000 })
      }}
    >
      Show custom
    </button>
  )
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.trim() === text
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}
