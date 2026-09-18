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

function feed(samples: number, amplitude = 0.25): void {
  const data = new Float32Array(samples).fill(amplitude)
  processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => data } })
}

/**
 * 按送包节奏喂够这些秒数的采样，并把假时钟推着走同样长。
 *
 * 采样是一拍一拍喂的，不是一次全塞进去：轮换的判定发生在**某一拍**上，塞成一整块
 * 就分不出「这一拍是静音还是说话」了。
 */
async function speakFor(seconds: number, amplitude = 0.25): Promise<number> {
  const ticks = Math.round((seconds * 1_000) / 200)
  for (let index = 0; index < ticks; index += 1) {
    feed(ASR_PCM_CHUNK_SAMPLES, amplitude)
    await vi.advanceTimersByTimeAsync(200)
  }
  return ticks
}

/** 一路不停地说到计划点之后：暖连接建好了，但还没接棒。 */
async function speakToWarming(text = "前半段") {
  const opened = await beginSession()
  const live = FakeSocket.instances[0]!
  // 先出字：没有文本的话 3 秒一到就会一直报「没有听到声音」，把失败列表淹掉。
  live.deliver({ code: 0, result: { slice_type: 1, index: 0, voice_text_str: text } })

  const speaking = await speakFor(45)
  const warming = await speakFor(4)
  expect(FakeSocket.instances).toHaveLength(2)

  return { ...opened, live, warm: FakeSocket.instances[1]!, ticks: speaking + warming }
}

/** 一路不停地说过硬顶：已经接棒，音频进的是第二条连接。 */
async function speakPastTheCeiling(text = "前半段") {
  const warmed = await speakToWarming(text)
  const handedOver = await speakFor(3)

  return { ...warmed, ticks: warmed.ticks + handedOver }
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

/**
 * 一条连接只能写 60 秒，所以说到一半要换一条接着写。这一组钉的是「用户什么都察觉
 * 不到」：不弹错、不丢字、不重复、不空转，轮换期间还能正常收尾。
 */
describe("VoiceSession 换连接", () => {
  it("说到计划点才开始预热，而且不给暖连接送音频", async () => {
    await beginSession()
    FakeSocket.instances[0]!.deliver({ code: 0, result: { slice_type: 1, index: 0, voice_text_str: "前半段" } })

    await speakFor(45)
    expect(FakeSocket.instances).toHaveLength(1)

    await speakFor(4)
    expect(FakeSocket.instances).toHaveLength(2)
    // 暖连接只是建好等着。给它喂静音会白白烧掉引擎那 60 秒的额度。
    expect(FakeSocket.instances[1]!.sent).toHaveLength(0)
  })

  it("一直不停就等到硬顶再接棒，旧的收尾、新的接着收", async () => {
    const { live, warm } = await speakPastTheCeiling()

    expect(live.sent.at(-1)).toBe(JSON.stringify({ type: "end" }))
    expect(warm.binaryFrames.length).toBeGreaterThan(0)
  })

  it("每一拍只取一次采样，两条连接加起来刚好等于拍数", async () => {
    // 取两次会在接缝处重发 200ms，少取一次会漏掉 200ms —— 两种都听不出来，
    // 只能靠数帧。
    const { live, warm, ticks } = await speakPastTheCeiling()

    expect(live.binaryFrames.length + warm.binaryFrames.length).toBe(ticks)
  })

  it("旧连接收尾后正常关闭，不会被当成网络断开", async () => {
    const { live, failures, transcripts } = await speakPastTheCeiling()

    // 引擎收下 end、回了最后一句，然后自己关掉连接——这是轮换的正常结局。
    live.onclose?.()
    await flush()

    expect(failures).not.toContain("network")
    expect(transcripts.at(-1)?.combined).toContain("前半段")
  })

  it("新连接接着往下写，前缀一个字都没被顶掉", async () => {
    const { warm, transcripts } = await speakPastTheCeiling()

    warm.deliver({ code: 0, result: { slice_type: 1, index: 0, voice_text_str: "后半段" } })

    expect(transcripts.at(-1)?.combined).toBe("前半段后半段")
  })

  it("接缝还没定稿时，新连接定稿的句子也只能排在它后面", async () => {
    // 顺序比颜色重要：接缝的定稿会晚一两秒回来，那之前新连接先定稿很正常，
    // 但把新连接挪到前面就是把用户说的话前后颠倒。
    const { warm, transcripts } = await speakPastTheCeiling()

    warm.deliver({ code: 0, result: { slice_type: 2, index: 0, voice_text_str: "后半段。" } })

    expect(transcripts.at(-1)?.stable).toBe("")
    expect(transcripts.at(-1)?.combined).toBe("前半段后半段。")
  })

  it("旧连接定稿时接缝被换掉，不是接在后面", async () => {
    // 引擎收到 end 会把最后一句整个重写一遍，实测补过词、也改过错字。
    const { live, transcripts } = await speakPastTheCeiling()

    live.deliver({ code: 0, final: 1, result: { slice_type: 2, index: 0, voice_text_str: "前半段，说完了。" } })
    await flush()

    expect(transcripts.at(-1)?.stable).toBe("前半段，说完了。")
    expect(transcripts.at(-1)?.combined).toBe("前半段，说完了。")
  })

  it("定稿之后再迟到的那几帧不改变已经发布的结果", async () => {
    // 旧连接收尾完之后还会吐一两帧出来。让它盖回去，接缝处就会冒出重复或残缺的字。
    const { live, transcripts } = await speakPastTheCeiling()
    const settled = transcripts.at(-1)

    live.deliver({ code: 0, result: { slice_type: 1, index: 0, voice_text_str: "迟到的半句" } })

    expect(transcripts.at(-1)).toEqual(settled)
  })

  it("预热期间主连接断线，照旧报网络断开，暖连接一并关掉", async () => {
    // 轮换不能把既有的失败语义改掉：主连接断了就是要告诉用户，不能因为
    // 「反正还有一条暖的」就悄悄吞掉。
    const { live, warm, failures } = await speakToWarming()

    live.onclose?.()
    await flush()

    expect(failures).toContain("network")
    expect(warm.readyState).toBe(3)
  })

  it("预热失败不冒到界面上，之后还会再试", async () => {
    // 用户什么都没做错，主连接也还好好的，这时候弹错反而莫名其妙。
    const { failures } = await beginSession()
    const live = FakeSocket.instances[0]!
    live.deliver({ code: 0, result: { slice_type: 1, index: 0, voice_text_str: "前半段" } })
    const framesBefore = live.binaryFrames.length

    // 第一次预热签名就失败。
    signSession.mockRejectedValueOnce(new Error("签名接口挂了"))
    await speakFor(48)

    expect(failures).not.toContain("network")
    expect(live.binaryFrames.length).toBeGreaterThan(framesBefore)
    // 退避一下接着试，第二条连接就是重试那次建起来的——失败一次就放弃的话，
    // 用户说到 60 秒还是会断。
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it("预热还没接棒就点完成：暖连接关掉，文本里是整段", async () => {
    const { session, live, warm } = await speakToWarming()

    const finishing = session.finish()
    await flush()
    expect(warm.readyState).toBe(3)

    live.deliver({ code: 0, final: 1, result: { slice_type: 2, index: 0, voice_text_str: "前半段，说完了。" } })
    await expect(finishing).resolves.toBe("前半段，说完了。")
  })

  it("接棒之后再收尾，接缝那一整段都在", async () => {
    // 接缝是引擎改写过的版本，不是冻结时那份——两者实测长度都不一样。
    const { session, live, warm } = await speakPastTheCeiling()
    live.deliver({ code: 0, final: 1, result: { slice_type: 2, index: 0, voice_text_str: "前半段，说完了。" } })
    await flush()

    const finishing = session.finish()
    await flush()
    warm.deliver({ code: 0, final: 1, result: { slice_type: 2, index: 0, voice_text_str: "后半段。" } })

    await expect(finishing).resolves.toBe("前半段，说完了。后半段。")
  })

  it("接棒之后取消，两条连接都关掉，文本全丢", async () => {
    const { session, live, warm } = await speakPastTheCeiling()

    session.cancel()

    expect(live.readyState).toBe(3)
    expect(warm.readyState).toBe(3)
    await expect(session.finish()).resolves.toBe("")
  })
})
