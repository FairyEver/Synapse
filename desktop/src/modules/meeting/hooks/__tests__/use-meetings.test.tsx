/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseMeetingDetail, SynapseMeetingSummary } from "@/types/meeting"
import { useMeetingDetail, useMeetingList } from "../use-meetings"

const bridge = vi.hoisted(() => ({
  meeting: { entry: { get: vi.fn(), list: vi.fn() } },
}))

vi.mock("@/lib/electron-bridge", () => ({ requireSynapseBridge: () => bridge }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => {
  for (const root of roots) act(() => { root.unmount() })
  roots = []
  document.body.innerHTML = ""
})

describe("meeting request lifecycle", () => {
  it.each(["resolve", "reject"] as const)("ignores a detail request that %ss after selection is cleared", async (outcome) => {
    const pending = deferred<SynapseMeetingDetail>()
    bridge.meeting.entry.get.mockReturnValue(pending.promise)
    const root = mountProbe()
    let state!: ReturnType<typeof useMeetingDetail>
    const capture = (next: ReturnType<typeof useMeetingDetail>) => { state = next }
    await act(async () => { root.render(<DetailProbe meetingId="removed" onState={capture} />) })
    await act(async () => { root.render(<DetailProbe meetingId={null} onState={capture} />) })
    expect(state).toEqual({ data: null, loading: false, error: null })

    await act(async () => {
      if (outcome === "resolve") pending.resolve(detail("removed"))
      else pending.reject(new Error("old detail failed"))
      await Promise.resolve()
    })

    expect(state).toEqual({ data: null, loading: false, error: null })
    expect(bridge.meeting.entry.get).toHaveBeenCalledTimes(1)
  })

  it("applies only the latest detail when responses arrive out of order", async () => {
    const first = deferred<SynapseMeetingDetail>()
    const second = deferred<SynapseMeetingDetail>()
    bridge.meeting.entry.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const root = mountProbe()
    let state!: ReturnType<typeof useMeetingDetail>
    const capture = (next: ReturnType<typeof useMeetingDetail>) => { state = next }
    await act(async () => { root.render(<DetailProbe meetingId="first" onState={capture} />) })
    await act(async () => { root.render(<DetailProbe meetingId="second" onState={capture} />) })
    await act(async () => { second.resolve(detail("second")); await second.promise })
    await act(async () => { first.resolve(detail("first")); await first.promise })

    expect(state.data?.id).toBe("second")
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it("keeps detail visible during a refresh of the same recording", async () => {
    const pending = deferred<SynapseMeetingDetail>()
    bridge.meeting.entry.get.mockResolvedValueOnce(detail("same")).mockReturnValueOnce(pending.promise)
    const root = mountProbe()
    let state!: ReturnType<typeof useMeetingDetail>
    const capture = (next: ReturnType<typeof useMeetingDetail>) => { state = next }
    await act(async () => { root.render(<DetailProbe meetingId="same" onState={capture} />) })
    await act(async () => { root.render(<DetailProbe meetingId="same" refreshKey={1} onState={capture} />) })
    expect(state.data?.id).toBe("same")
    expect(state.loading).toBe(true)

    await act(async () => { pending.resolve(detail("same")); await pending.promise })
    expect(state.loading).toBe(false)
  })

  it("ignores an old list response after a newer refresh succeeds", async () => {
    const pending = deferred<readonly SynapseMeetingSummary[]>()
    bridge.meeting.entry.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([summary("new")])
    const root = mountProbe()
    let state!: ReturnType<typeof useMeetingList>
    const capture = (next: ReturnType<typeof useMeetingList>) => { state = next }
    await act(async () => { root.render(<ListProbe refreshKey={0} onState={capture} />) })
    await act(async () => { root.render(<ListProbe refreshKey={1} onState={capture} />) })
    await act(async () => { pending.resolve([summary("old")]); await pending.promise })

    expect(state.data.map((meeting) => meeting.id)).toEqual(["new"])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })
})

function DetailProbe({ meetingId, refreshKey = 0, onState }: {
  readonly meetingId: string | null
  readonly refreshKey?: number
  readonly onState: (state: ReturnType<typeof useMeetingDetail>) => void
}) {
  const state = useMeetingDetail(meetingId, refreshKey)
  onState(state)
  return null
}

function ListProbe({ refreshKey, onState }: {
  readonly refreshKey: number
  readonly onState: (state: ReturnType<typeof useMeetingList>) => void
}) {
  const state = useMeetingList(refreshKey)
  onState(state)
  return null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function mountProbe(): Root {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  return root
}

function summary(id: string): SynapseMeetingSummary {
  return {
    id, title: id, startedAt: "2026-09-19T00:00:00.000Z", durationMs: 1000,
    speakerCount: 0, status: "done", minutesStatus: "none", createdAt: "2026-09-19T00:00:00.000Z",
    recording: { status: "ready", mimeType: "audio/mp4", size: 100, durationMs: 1000, deletedAt: null },
  }
}

function detail(id: string): SynapseMeetingDetail {
  return { ...summary(id), failureReason: null, speakers: [], segments: [], minutes: null, minutesFailureReason: null }
}
