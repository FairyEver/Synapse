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

    await act(async () => {
      getButtonByName(container, /1 条待同步/).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(container.textContent).toContain("Team Repo")
    expect(container.textContent).toContain("1 条变更等待同步")
    expect(onRetry).not.toHaveBeenCalled()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })
})
