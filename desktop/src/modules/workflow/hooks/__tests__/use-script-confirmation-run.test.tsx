/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useScriptConfirmationRun } from "../use-script-confirmation-run"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type HookValue = ReturnType<typeof useScriptConfirmationRun>

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots.length = 0
  document.body.innerHTML = ""
})

describe("useScriptConfirmationRun", () => {
  it("shares one active invocation across concurrent calls", async () => {
    const hook = renderHook()
    let resolveInitial!: (value: { runId: string }) => void
    const invoke = vi.fn(() => new Promise<{ runId: string }>((resolve) => {
      resolveInitial = resolve
    }))

    const first = hook.current.runWithScriptConfirmation(invoke)
    const second = hook.current.runWithScriptConfirmation(invoke)
    expect(invoke).toHaveBeenCalledOnce()

    await act(async () => {
      resolveInitial({ runId: "run-1" })
      await Promise.resolve()
    })

    await expect(first).resolves.toEqual({ runId: "run-1" })
    await expect(second).resolves.toEqual({ runId: "run-1" })
  })

  it("allows only one confirm invocation and ignores cancel after acceptance", async () => {
    let resolveConfirm!: (value: { runId: string }) => void
    const invoke = vi.fn(async (token?: string) => {
      if (!token) return review("token-1", "source-1")
      return new Promise<{ runId: string }>((resolve) => {
        resolveConfirm = resolve
      })
    })
    const hook = renderHook()
    const run = hook.current.runWithScriptConfirmation(invoke)
    await act(async () => {
      await Promise.resolve()
    })

    let firstConfirm!: Promise<void>
    act(() => {
      firstConfirm = hook.current.scriptConfirmation.confirm()
      void hook.current.scriptConfirmation.confirm()
      hook.current.scriptConfirmation.cancel()
    })

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(hook.current.scriptConfirmation.confirming).toBe(true)
    await act(async () => {
      resolveConfirm({ runId: "run-1" })
      await firstConfirm
    })
    await expect(run).resolves.toEqual({ runId: "run-1" })
  })

  it("keeps the operation pending when the token changes and requires a new explicit confirm", async () => {
    const invoke = vi.fn(async (token?: string) => {
      if (!token) return review("token-1", "source-1")
      if (token === "token-1") return review("token-2", "source-2")
      return { runId: "run-2" }
    })
    const hook = renderHook()
    const run = hook.current.runWithScriptConfirmation(invoke)
    await act(async () => {
      await Promise.resolve()
      await hook.current.scriptConfirmation.confirm()
    })

    expect(hook.current.scriptConfirmation.confirming).toBe(false)
    expect(hook.current.scriptConfirmation.scripts[0]?.source).toBe("source-2")
    await act(async () => {
      await hook.current.scriptConfirmation.confirm()
    })
    await expect(run).resolves.toEqual({ runId: "run-2" })
    expect(invoke.mock.calls.map(([token]) => token)).toEqual([undefined, "token-1", "token-2"])
  })

  it("settles exactly once when unmounted during the initial invocation", async () => {
    let resolveInitial!: (value: unknown) => void
    const invoke = vi.fn(() => new Promise((resolve) => {
      resolveInitial = resolve
    }))
    const hook = renderHook()
    const run = hook.current.runWithScriptConfirmation(invoke)

    act(() => hook.root.unmount())
    roots.splice(roots.indexOf(hook.root), 1)
    await expect(run).resolves.toBeNull()

    resolveInitial(review("late-token", "late-source"))
    await Promise.resolve()
    await expect(run).resolves.toBeNull()
  })

  it("settles a synchronous invoke exception without leaving an active operation", async () => {
    const hook = renderHook()
    const error = new Error("invoke failed")
    const invoke = vi.fn(() => {
      throw error
    }) as unknown as () => Promise<unknown>

    let failedRun!: Promise<unknown | null>
    act(() => {
      failedRun = hook.current.runWithScriptConfirmation(invoke)
    })
    await expect(failedRun).rejects.toBe(error)

    let nextResult: unknown
    await act(async () => {
      nextResult = await hook.current.runWithScriptConfirmation(async () => ({ runId: "run-2" }))
    })
    expect(nextResult).toEqual({ runId: "run-2" })
  })
})

function renderHook(): { readonly root: Root; readonly current: HookValue } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const state: { current?: HookValue } = {}
  function Harness() {
    state.current = useScriptConfirmationRun()
    return null
  }
  act(() => root.render(<Harness />))
  return {
    root,
    get current() {
      if (!state.current) throw new Error("Hook not rendered")
      return state.current
    },
  }
}

function review(token: string, source: string) {
  return {
    errors: [{
      type: "script_confirmation_required",
      details: {
        confirmationToken: token,
        scripts: [{
          workflowName: "Workflow",
          runtime: "Node.js",
          nodeName: "Script",
          source,
        }],
      },
    }],
  }
}
