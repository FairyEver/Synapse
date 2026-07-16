/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { EditorScanResult } from "@/types/editor-scan"
import { useEditorScan } from "../hooks/use-editor-scan"

const mocks = vi.hoisted(() => ({
  cancelScan: vi.fn(),
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
  scanAll: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({
    editorScan: {
      cancelScan: mocks.cancelScan,
      scanAll: mocks.scanAll,
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

type Deferred<T> = {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

function createScanResult(label: string): EditorScanResult {
  return {
    global: [{
      duplicateSkillNames: [],
      editorId: "claude-code",
      editorLabel: label,
      rules: [],
      rulesSupported: true,
      skills: [],
      status: "detected",
    }],
    projects: [],
  }
}

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("useEditorScan", () => {
  it("ignores stale scan results when refresh requests resolve out of order", async () => {
    const initial = createDeferred<EditorScanResult>()
    const stale = createDeferred<EditorScanResult>()
    const latest = createDeferred<EditorScanResult>()
    mocks.scanAll
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise)

    let refresh: (() => Promise<void>) | null = null

    function Probe() {
      const state = useEditorScan()
      refresh = state.refresh
      return <span data-testid="editor-label">{state.data?.global[0]?.editorLabel ?? ""}</span>
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe />)
    })

    await act(async () => {
      initial.resolve(createScanResult("initial"))
      await initial.promise
    })

    let staleRefresh: Promise<void> | undefined
    let latestRefresh: Promise<void> | undefined
    await act(async () => {
      staleRefresh = refresh?.()
      latestRefresh = refresh?.()
    })

    await act(async () => {
      latest.resolve(createScanResult("latest"))
      await latestRefresh
    })
    expect(document.querySelector('[data-testid="editor-label"]')?.textContent).toBe("latest")

    await act(async () => {
      stale.resolve(createScanResult("stale"))
      await staleRefresh
    })
    expect(document.querySelector('[data-testid="editor-label"]')?.textContent).toBe("latest")
    expect(mocks.cancelScan).toHaveBeenCalledTimes(1)
    expect(mocks.cancelScan).toHaveBeenCalledWith(mocks.scanAll.mock.calls[1]?.[0])
  })

  it("cancels the active scan when the page unmounts", async () => {
    const pending = createDeferred<EditorScanResult>()
    mocks.scanAll.mockReturnValueOnce(pending.promise)
    mocks.cancelScan.mockResolvedValue({ cancelled: true })

    function Probe() {
      useEditorScan()
      return null
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe />)
    })
    const request = mocks.scanAll.mock.calls[0]?.[0]

    await act(async () => {
      root.unmount()
      await Promise.resolve()
    })
    roots = roots.filter((candidate) => candidate !== root)

    expect(mocks.cancelScan).toHaveBeenCalledWith(request)
  })
})
