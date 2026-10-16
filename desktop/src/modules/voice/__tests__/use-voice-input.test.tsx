/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVoiceInput, type VoiceInputController } from "../use-voice-input"

const session = vi.hoisted(() => ({ finish: vi.fn<() => Promise<string>>(), cancel: vi.fn() }))
const begin = vi.hoisted(() => vi.fn())
vi.mock("../voice-session", () => ({ VoiceSession: { begin } }))
vi.mock("@/lib/electron-bridge", () => ({ requireSynapseBridge: () => ({ voice: { status: { get: async () => ({ available: true }) } } }) }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn() }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let voice: VoiceInputController
beforeEach(async () => {
  session.finish.mockReset().mockResolvedValue("识别结果")
  session.cancel.mockClear()
  begin.mockReset().mockResolvedValue(session)
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  function Probe() { voice = useVoiceInput(); return <span>{voice.state.phase}</span> }
  await act(async () => { root.render(<Probe />) })
})
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = "" })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}

describe("useVoiceInput 收尾", () => {
  it("从识别到异步写入完成全程互斥，第二次确认不能重复消费", async () => {
    const final = deferred<string>()
    const write = deferred<void>()
    session.finish.mockReturnValue(final.promise)
    await act(async () => voice.start())
    const consume = vi.fn(() => write.promise)
    let completion!: Promise<void>
    act(() => { completion = voice.confirm(consume) })
    expect(voice.state.phase).toBe("finishing")
    await act(async () => { await voice.confirm(consume); final.resolve("最终文本") })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume.mock.calls[0]).toEqual(["最终文本", expect.any(AbortSignal)])
    expect(voice.state.phase).toBe("finishing")
    await act(async () => { await voice.confirm(consume); write.resolve(); await completion })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(voice.state.phase).toBe("idle")
  })

  it("麦克风尚在启动时确认，等启动完成再收尾", async () => {
    const opening = deferred<typeof session>()
    begin.mockReturnValue(opening.promise)
    act(() => voice.start())
    const consume = vi.fn()
    let completion!: Promise<void>
    act(() => { completion = voice.confirm(consume) })
    await act(async () => { opening.resolve(session); await completion })
    expect(session.finish).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith("识别结果", expect.any(AbortSignal))
    expect(voice.state.phase).toBe("idle")
  })

  it("取消后迟到的识别结果不再写入", async () => {
    const final = deferred<string>()
    session.finish.mockReturnValue(final.promise)
    await act(async () => voice.start())
    const consume = vi.fn()
    let completion!: Promise<void>
    act(() => { completion = voice.confirm(consume) })
    act(() => voice.cancel())
    await act(async () => { final.resolve("迟到结果"); await completion })
    expect(consume).not.toHaveBeenCalled()
    expect(session.cancel).toHaveBeenCalled()
    expect(voice.state.phase).toBe("idle")
  })

  it("写入失败时释放收尾状态，错误交给调用方处理", async () => {
    await act(async () => voice.start())
    await act(async () => {
      await expect(voice.confirm(async () => { throw new Error("write failed") })).rejects.toThrow("write failed")
    })
    expect(voice.state.phase).toBe("idle")
  })
})
