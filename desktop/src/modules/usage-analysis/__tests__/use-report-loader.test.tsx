/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReportState } from "../shared/types"
import { useReportLoader } from "../shared/use-report-loader"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.debug.mockClear()
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
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

describe("useReportLoader", () => {
  it("preserves the original load error message and logs the failure", async () => {
    const loader = vi.fn(async () => {
      throw new Error("usage database unavailable")
    })
    const states: Array<ReportState<string>> = []
    const host = document.createElement("div")
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(<ReportLoaderProbe loader={loader} onState={(state) => states.push(state)} />)
    })

    expect(states.at(-1)?.error?.message).toBe("usage database unavailable")
    expect(rendererLogger.error).toHaveBeenCalledWith("Usage analysis report load failed.", {
      error: expect.any(Error),
    })
  })
})

function ReportLoaderProbe({
  loader,
  onState,
}: {
  readonly loader: () => Promise<string>
  readonly onState: (state: ReportState<string>) => void
}) {
  const state = useReportLoader(loader, [loader])

  useEffect(() => {
    onState(state)
  }, [onState, state])

  return null
}
