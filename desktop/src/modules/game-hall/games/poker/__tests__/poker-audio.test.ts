import { afterEach, describe, expect, it, vi } from "vitest"
import { createPokerAudio } from "../lib/poker-audio"

const warn = vi.hoisted(() => vi.fn())
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn }) }))
class FakeContext {
  state = "running"
  currentTime = 10
  destination = {}
  sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockImplementation(async () => { this.state = "closed" })
  decodeAudioData = vi.fn().mockResolvedValue({ duration: 0.3 })
  createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() } }
  createBufferSource() {
    const source = { buffer: null, onended: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }
    this.sources.push(source)
    return source
  }
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
async function ready() {
  const context = new FakeContext()
  vi.stubGlobal("AudioContext", vi.fn(function () { return context }))
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }))
  const audio = createPokerAudio()
  await audio.activate()
  return { context, audio }
}
describe("本地音频播放器", () => {
  it("交互后加载本地素材，以低音量调度；停止和卸载取消所有声音", async () => {
    const { audio, context } = await ready()
    audio.play([{ sound: "coin1", delay: 75, volume: 0.35 }])
    expect(context.sources[0].start).toHaveBeenCalledWith(10.075)
    audio.stop()
    expect(context.sources[0].stop).toHaveBeenCalled()
    await audio.dispose()
    expect(context.close).toHaveBeenCalledTimes(1)
  })
  it("素材未就绪或浏览器尚未允许播放时丢弃反馈，不排队补响", async () => {
    const { audio, context } = await ready()
    context.state = "suspended"
    audio.play([{ sound: "deal", delay: 0, volume: 0.28 }])
    expect(context.sources).toHaveLength(0)
    await audio.dispose()
  })
  it("退出时取消仍在加载的资源，不留下迟到声音或错误日志", async () => {
    const context = new FakeContext()
    vi.stubGlobal("AudioContext", vi.fn(function () { return context }))
    vi.stubGlobal("fetch", vi.fn((_url, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    })))
    const audio = createPokerAudio()
    const loading = audio.activate()
    audio.play([{ sound: "coin1", delay: 0, volume: 0.35 }])
    expect(context.sources).toHaveLength(0)
    await audio.dispose()
    await loading
    expect(warn).not.toHaveBeenCalled()
  })
  it("素材加载失败记录一次错误，不影响牌局也不进入播放", async () => {
    const context = new FakeContext()
    vi.stubGlobal("AudioContext", vi.fn(function () { return context }))
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("missing asset")))
    const audio = createPokerAudio()
    await audio.activate()
    audio.play([{ sound: "coin1", delay: 0, volume: 0.35 }])
    expect(context.sources).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    await audio.dispose()
  })
  it("连续更新替换声音批次，避免多桌动作堆积", async () => {
    const { audio, context } = await ready()
    const cue = { sound: "coin1" as const, delay: 0, volume: 0.35 }
    audio.play([cue])
    audio.play([cue])
    expect(context.sources[0].stop).toHaveBeenCalled()
    await audio.dispose()
  })
  it("音频设备错误不向牌桌抛出异常", async () => {
    const { audio, context } = await ready()
    vi.spyOn(context, "createBufferSource").mockImplementation(() => { throw new Error("audio device unavailable") })
    expect(() => audio.play([{ sound: "coin1", delay: 0, volume: 0.35 }])).not.toThrow()
    expect(warn).toHaveBeenCalled()
    await audio.dispose()
  })
})
