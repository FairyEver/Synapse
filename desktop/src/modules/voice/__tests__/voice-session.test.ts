/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ASR_PCM_CHUNK_BYTES, ASR_PCM_CHUNK_SAMPLES } from "../asr-pcm"
import type { AsrTranscript } from "../asr-transcript"

const signSession = vi.hoisted(() => vi.fn(async () => ({
  url: "wss://asr.test/session",
  voiceId: "voice-1",
  expiredAt: 1_700_000_300,
})))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({ voice: { session: { sign: signSession } } }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

/* ------------------------------------------------------------------ *
 * 假麦克风与假 WebSocket：真正的一段录音要过权限、AudioContext 和网络，
 * 这里的目的是把「录音 → 送包 → 收结果 → 收尾」这条链路钉住。
 * ------------------------------------------------------------------ */

class FakeSocket {
  static readonly OPEN = 1
  static instances: FakeSocket[] = []
  readyState = FakeSocket.OPEN
  readonly sent: (string | Uint8Array)[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  get binaryFrames(): Uint8Array[] {
    return this.sent.filter((entry): entry is Uint8Array => typeof entry !== "string")
  }
}

type FakeProcessor = {
  onaudioprocess: ((event: { inputBuffer: { getChannelData: (i: number) => Float32Array } }) => void) | null
  connect: () => void
  disconnect: () => void
}

let processor: FakeProcessor

class FakeAudioContext {
  readonly sampleRate = 16_000
  state = "running"
  readonly destination = {}
  createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} } }
  createScriptProcessor() {
    // 必须返回同一个对象引用：采集层把 onaudioprocess 挂在返回值上，用展开复制
    // 的话测试拿到的永远是个没被赋值的副本，喂进去的采样全部丢掉。
    processor = { onaudioprocess: null, connect: () => {}, disconnect: () => {} }
    return processor
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> { this.state = "closed" }
}

function feed(samples: number): void {
  const data = new Float32Array(samples).fill(0.25)
  processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => data } })
}

/** 让已排队的 promise 回调跑完，但不推进定时器。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function beginSession(events: Partial<Parameters<typeof import("../voice-session").VoiceSession.begin>[0]> = {}) {
  const { VoiceSession } = await import("../voice-session")
  const transcripts: AsrTranscript[] = []
  const failures: string[] = []
  const session = await VoiceSession.begin({
    onTranscript: (transcript) => transcripts.push(transcript),
    onElapsed: () => {},
    onFailure: (failure) => failures.push(failure),
    ...events,
  })
  return { session, transcripts, failures }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  signSession.mockClear()
  vi.stubGlobal("WebSocket", FakeSocket)
  vi.stubGlobal("AudioContext", FakeAudioContext)
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [{ onended: null, stop: () => {} }],
        getTracks: () => [{ stop: () => {} }],
      })),
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("VoiceSession", () => {
  it("连的是主进程签发的 URL，不是自己拼的", async () => {
    await beginSession()
    expect(signSession).toHaveBeenCalledTimes(1)
    expect(FakeSocket.instances[0]?.url).toBe("wss://asr.test/session")
  })

  it("每 200ms 送一包，整包 6400 字节", async () => {
    await beginSession()
    const socket = FakeSocket.instances[0]!

    // 200ms 的 16k 单声道采样正好 3200 个。
    feed(ASR_PCM_CHUNK_SAMPLES)
    await vi.advanceTimersByTimeAsync(200)

    expect(socket.binaryFrames).toHaveLength(1)
    expect(socket.binaryFrames[0]).toHaveLength(ASR_PCM_CHUNK_BYTES)
  })

  it("采样不足也补满一包，保证送出的时长等于真实时间", async () => {
    await beginSession()
    const socket = FakeSocket.instances[0]!

    feed(100)
    await vi.advanceTimersByTimeAsync(200)

    expect(socket.binaryFrames[0]).toHaveLength(ASR_PCM_CHUNK_BYTES)
    // 前 100 个采样是真声音，其余是补的静音。
    const view = new DataView(socket.binaryFrames[0]!.buffer)
    expect(view.getInt16(0, true)).toBeGreaterThan(0)
    expect(view.getInt16(190 * 2, true)).toBe(0)
  })

  it("未定稿的文字不当成定稿，定稿后才落进 stable", async () => {
    const { transcripts } = await beginSession()
    const socket = FakeSocket.instances[0]!

    socket.deliver({ code: 0, result: { slice_type: 1, index: 0, voice_text_str: "帮我看看" } })
    expect(transcripts.at(-1)?.stable).toBe("")
    expect(transcripts.at(-1)?.unstable).toBe("帮我看看")

    socket.deliver({ code: 0, result: { slice_type: 2, index: 0, voice_text_str: "帮我看看终端。" } })
    expect(transcripts.at(-1)?.stable).toBe("帮我看看终端。")
    expect(transcripts.at(-1)?.unstable).toBe("")
  })

  it("finish 会先送完缓冲里的尾巴，再发结束帧", async () => {
    const { session } = await beginSession()
    const socket = FakeSocket.instances[0]!

    feed(ASR_PCM_CHUNK_SAMPLES + 500)
    await vi.advanceTimersByTimeAsync(200)
    const framesBefore = socket.binaryFrames.length

    const finishing = session.finish()
    await flush()
    expect(socket.binaryFrames.length).toBeGreaterThan(framesBefore)
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "end" }))

    // 引擎把最后一句定稿回来，finish 立刻收尾而不是等满超时。
    socket.deliver({ code: 0, final: 1, result: { slice_type: 2, index: 0, voice_text_str: "git status" } })
    await expect(finishing).resolves.toBe("git status")
  })

  it("服务端说服务没开通时不重连，直接报不可用", async () => {
    const { failures } = await beginSession()
    const socket = FakeSocket.instances[0]!

    // 4003 = 账号未开通本服务。换个签名重连也还是这个结果，重连只是原地打转。
    socket.deliver({ code: 4003, message: "账号未开通本服务" })
    await flush()

    expect(signSession).toHaveBeenCalledTimes(1)
    expect(failures).toEqual(["unavailable"])
  })

  it("鉴权被拒时换一条新签名重连一次", async () => {
    await beginSession()

    // 4002 = 鉴权失败，签名过期就是这个样子。
    FakeSocket.instances[0]!.deliver({ code: 4002, message: "鉴权失败" })
    await flush()

    expect(signSession).toHaveBeenCalledTimes(2)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it("还没出字时断线会自动换一条新签名重连一次", async () => {
    await beginSession()
    expect(FakeSocket.instances).toHaveLength(1)

    FakeSocket.instances[0]!.onclose?.()
    await flush()

    expect(signSession).toHaveBeenCalledTimes(2)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it("已经听到内容后断线就保留结果，不再自动重连", async () => {
    const { failures } = await beginSession()
    const socket = FakeSocket.instances[0]!
    socket.deliver({ code: 0, result: { slice_type: 2, index: 0, voice_text_str: "跑一下" } })

    socket.onclose?.()
    await flush()

    expect(signSession).toHaveBeenCalledTimes(1)
    expect(failures).toEqual(["network"])
  })

  it("取消丢掉全部文本，含已定稿部分", async () => {
    const { session } = await beginSession()
    const socket = FakeSocket.instances[0]!
    socket.deliver({ code: 0, result: { slice_type: 2, index: 0, voice_text_str: "会被丢掉" } })

    session.cancel()

    expect(socket.readyState).toBe(3)
    // 取消之后 finish 不再产出文本。
    await expect(session.finish()).resolves.toBe("")
  })

  it("约 3 秒没出字提示没有听到声音，但不结束录音", async () => {
    const { failures } = await beginSession()

    await vi.advanceTimersByTimeAsync(3_100)

    expect(failures).toContain("silence")
    // 仍然在录音：送包定时器还在走。
    feed(ASR_PCM_CHUNK_SAMPLES)
    await vi.advanceTimersByTimeAsync(200)
    expect(FakeSocket.instances[0]!.binaryFrames.length).toBeGreaterThan(0)
  })
})
