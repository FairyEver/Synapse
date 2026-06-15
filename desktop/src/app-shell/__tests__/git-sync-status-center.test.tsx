// @vitest-environment jsdom

import { act, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GitSyncStatusCenter } from "../components/git-sync-status-center"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/ui/popover", async () => {
  const React = await vi.importActual<typeof import("react")>("react")

  type PopoverContextValue = {
    open: boolean
    setOpen: (open: boolean) => void
  }

  const PopoverContext = React.createContext<PopoverContextValue | null>(null)

  function usePopoverContext(): PopoverContextValue {
    const context = React.useContext(PopoverContext)

    if (!context) {
      throw new Error("PopoverTrigger must be rendered inside Popover.")
    }

    return context
  }

  function Popover({ children }: { children?: ReactNode }) {
    const [open, setOpen] = React.useState(false)

    return React.createElement(
      PopoverContext.Provider,
      { value: { open, setOpen } },
      children,
    )
  }

  function PopoverTrigger({
    asChild,
    children,
  }: {
    asChild?: boolean
    children?: ReactNode
  }) {
    const context = usePopoverContext()

    if (asChild && React.isValidElement(children)) {
      const child = children as ReactElement<{
        "aria-expanded"?: boolean
        onClick?: (event: React.MouseEvent<HTMLElement>) => void
      }>

      return React.cloneElement(child, {
        "aria-expanded": context.open,
        onClick: (event: React.MouseEvent<HTMLElement>) => {
          child.props.onClick?.(event)
          context.setOpen(true)
        },
      })
    }

    return React.createElement(
      "button",
      {
        "aria-expanded": context.open,
        onClick: () => context.setOpen(true),
        type: "button",
      },
      children,
    )
  }

  function PopoverContent({
    children,
    className,
  }: {
    children?: ReactNode
    className?: string
  }) {
    const context = usePopoverContext()

    if (!context.open) {
      return null
    }

    return React.createElement("div", {
      className,
      "data-slot": "popover-content",
    }, children)
  }

  return {
    Popover,
    PopoverContent,
    PopoverTrigger,
  }
})

const mountedRoots: Array<{
  container: HTMLDivElement
  root: Root
}> = []

function render(element: ReactElement): HTMLDivElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  mountedRoots.push({ container, root })
  return container
}

function getButtonByName(container: HTMLElement, name: RegExp): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => name.test(candidate.textContent ?? ""))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`)
  }

  return button
}

afterEach(() => {
  for (const { container, root } of mountedRoots.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

describe("GitSyncStatusCenter", () => {
  it("opens details without starting sync", async () => {
    const onRetry = vi.fn()
    const onOpenSettings = vi.fn()
    const container = render(
      <GitSyncStatusCenter
        repository={{
          uuid: "repo-1",
          name: "Team Repo",
          localPath: "/repo",
          contentDirs: {},
        }}
        status="pending"
        pendingCount={1}
        snapshot={{
          repositoryUuid: "repo-1",
          status: "pending",
          operation: null,
          phase: "completed",
          pendingCount: 1,
          pendingItems: [],
          message: "1 条变更等待同步",
          retryCount: 0,
          canRetryNow: true,
          primaryAction: "retry",
        }}
        onRetry={onRetry}
        onOpenSettings={onOpenSettings}
      />,
    )

    const trigger = getButtonByName(container, /1 条待同步/)

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(container.textContent).toContain("Team Repo")
    expect(container.textContent).toContain("1 条变更等待同步")
    expect(onRetry).not.toHaveBeenCalled()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  it("renders a bounded pending item list", async () => {
    const pendingItems = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      commitHash: null,
      action: "update",
      targetId: `rule-${index + 1}`,
      title: `Rule ${index + 1}`,
      createdAt: "2026-06-14T00:00:00.000Z",
      retryCount: 0,
      lastError: null,
      lastErrorCategory: null,
      lastAttemptAt: null,
      nextRetryAt: null,
    }))
    const container = render(
      <GitSyncStatusCenter
        repository={{
          uuid: "repo-1",
          name: "Team Repo",
          localPath: "/repo",
          contentDirs: {},
        }}
        status="pending"
        pendingCount={120}
        snapshot={{
          repositoryUuid: "repo-1",
          status: "pending",
          operation: null,
          phase: "completed",
          pendingCount: 120,
          pendingItems,
          message: "120 条变更等待同步",
          retryCount: 0,
          canRetryNow: true,
          primaryAction: "retry",
        }}
        onRetry={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )

    await act(async () => {
      getButtonByName(container, /9\+ 条待同步/).click()
    })

    expect(container.textContent).toContain("Rule 100")
    expect(container.textContent).not.toContain("Rule 101")
    expect(container.textContent).toContain("还有 20 项")
  })

  it("does not render retry when a blocked snapshot requires another primary action", async () => {
    const onRetry = vi.fn()
    const onOpenSettings = vi.fn()
    const container = render(
      <GitSyncStatusCenter
        repository={{
          uuid: "repo-1",
          name: "Team Repo",
          localPath: "/repo",
          contentDirs: {},
        }}
        status="attention"
        pendingCount={1}
        snapshot={{
          repositoryUuid: "repo-1",
          status: "attention",
          operation: null,
          phase: "blocked",
          pendingCount: 1,
          pendingItems: [],
          message: "本地目录不是 Git 仓库",
          retryCount: 1,
          canRetryNow: true,
          primaryAction: "open-settings",
        }}
        onRetry={onRetry}
        onOpenSettings={onOpenSettings}
      />,
    )

    await act(async () => {
      getButtonByName(container, /需要处理/).click()
    })

    expect(container.textContent).toContain("仓库设置")
    expect(container.textContent).not.toContain("立即同步")
    expect(onRetry).not.toHaveBeenCalled()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })
})
