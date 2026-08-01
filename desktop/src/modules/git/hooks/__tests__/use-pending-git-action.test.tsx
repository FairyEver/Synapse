/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { usePendingGitAction, type PendingGitAction } from "../use-pending-git-action"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function HookHarness({
  onStatus,
}: {
  readonly onStatus: (status: ReturnType<typeof usePendingGitAction>) => void
}) {
  const status = usePendingGitAction()
  onStatus(status)
  return null
}

describe("usePendingGitAction", () => {
  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => {
        root.unmount()
      })
    }
    document.body.innerHTML = ""
  })

  it("sets and clears a pending clone action", async () => {
    const statuses: Array<ReturnType<typeof usePendingGitAction>> = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookHarness onStatus={(status) => statuses.push(status)} />)
    })

    const action: PendingGitAction = {
      type: "clone",
      host: "github.com",
      protocol: "https",
      provider: "github",
      input: {
        directoryName: "docs",
        parentDirectory: "/work",
        remoteUrl: "https://github.com/acme/docs.git",
      },
    }

    await act(async () => {
      statuses.at(-1)!.setPendingAction(action)
    })

    expect(statuses.at(-1)!.pendingAction).toEqual(action)

    await act(async () => {
      statuses.at(-1)!.clearPendingAction()
    })

    expect(statuses.at(-1)!.pendingAction).toBeNull()
  })

  it("sets and clears a pending repository action", async () => {
    const statuses: Array<ReturnType<typeof usePendingGitAction>> = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookHarness onStatus={(status) => statuses.push(status)} />)
    })

    const action: PendingGitAction = {
      type: "push",
      host: "gitlab.com",
      protocol: "ssh",
      provider: "gitlab",
      repositoryId: "repo-1",
    }

    await act(async () => {
      statuses.at(-1)!.setPendingAction(action)
    })

    expect(statuses.at(-1)!.pendingAction).toEqual(action)

    await act(async () => {
      statuses.at(-1)!.clearPendingAction()
    })

    expect(statuses.at(-1)!.pendingAction).toBeNull()
  })
})
