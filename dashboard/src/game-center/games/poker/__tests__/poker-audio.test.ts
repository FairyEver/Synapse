import { afterEach, describe, expect, it, vi } from "vitest"
import { createPokerAudio } from "../lib/poker-audio"

const warn = vi.hoisted(() => vi.fn())
vi.mock("@/game-center/runtime/logging", () => ({ createRendererLogger: () => ({ warn }) }))
class FakeContext {
  state = "running"
  currentTime = 10
  destination = {}
  sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; playbackRate: { value: number } }[] = []
  gains: { gain: { value: number } }[] = []
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockImplementation(async () => { this.state = "closed" })
  decodeAudioData = vi.fn().mockResolvedValue({ duration: 0.3 })
  createGain() {
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
    this.gains.push(gain)
    return gain
  }
  createBufferSource() {
    const source = { playbackRate: { value: 1 }, buffer: null, onended: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }
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
    audio.play([{ sound: "chip", delay: 75, volume: 0.35 }])
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
    audio.play([{ sound: "chip", delay: 0, volume: 0.35 }])
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
    audio.play([{ sound: "chip", delay: 0, volume: 0.35 }])
    expect(context.sources).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
    await audio.dispose()
  })
  it("连续更新替换声音批次，避免多桌动作堆积", async () => {
    const { audio, context } = await ready()
    const cue = { sound: "chip" as const, delay: 0, volume: 0.35 }
    audio.play([cue])
    audio.play([cue])
    expect(context.sources[0].stop).toHaveBeenCalled()
    await audio.dispose()
  })
  it("音频设备错误不向牌桌抛出异常", async () => {
    const { audio, context } = await ready()
    vi.spyOn(context, "createBufferSource").mockImplementation(() => { throw new Error("audio device unavailable") })
    expect(() => audio.play([{ sound: "chip", delay: 0, volume: 0.35 }])).not.toThrow()
    expect(warn).toHaveBeenCalled()
    await audio.dispose()
  })
  it("筹码保持当前音量，翻牌与下注结算同批出现时不截断声音", async () => {
    const { audio, context } = await ready()
    const money = Array.from({ length: 16 }, (_, i) => ({ sound: "chip" as const, delay: i * 55, volume: 0.5 }))
    const cards = Array.from({ length: 3 }, (_, i) => ({ sound: "card" as const, delay: i * 120, volume: 0.28 }))
    audio.play([...money, ...cards, ...money.map(c => ({ ...c, delay: c.delay + 520 }))])
    expect(context.sources).toHaveLength(35)
    expect(context.gains[1].gain.value).toBe(0.5)
    expect(context.gains[17].gain.value).toBe(0.28)
    await audio.dispose()
  })
  it("每枚落地声叠加播放，后续落地和快照反馈不截断先前尾音", async () => {
    const { audio, context } = await ready()
    const cue = { sound: "chip" as const, delay: 0, volume: 0.3, playbackRate: 0.98 }
    audio.play([{ sound: "card", delay: 120, volume: 0.28 }])
    audio.land(cue)
    audio.land({ ...cue, playbackRate: 1.02 })
    audio.play([{ sound: "fold", delay: 0, volume: 0.25 }])
    expect(context.sources).toHaveLength(4)
    expect(context.sources[0].stop).toHaveBeenCalledTimes(1)
    expect(context.sources[1].stop).not.toHaveBeenCalled()
    expect(context.sources[2].stop).not.toHaveBeenCalled()
    expect(context.sources[1].start).toHaveBeenCalledWith(10)
    expect(context.sources[1].playbackRate.value).toBe(0.98)
    audio.stop()
    expect(context.sources.slice(1).every(s => s.stop.mock.calls.length === 1)).toBe(true)
    await audio.dispose()
  })
})
