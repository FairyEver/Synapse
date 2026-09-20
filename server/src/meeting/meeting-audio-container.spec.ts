import { describe, expect, it } from "vitest"

import {
  inspectMeetingAudioContainer,
  MEETING_AUDIO_CONTAINER_BROKEN_REASON,
  MEETING_AUDIO_PROBE_BYTES,
  readMeetingAudioDurationMs,
} from "./meeting-audio-container"

const PROBE = MEETING_AUDIO_PROBE_BYTES

function box(type: string, payloadBytes: number): Buffer {
  const buffer = Buffer.alloc(8 + payloadBytes)
  buffer.writeUInt32BE(buffer.length, 0)
  buffer.write(type, 4, "latin1")
  return buffer
}

/** 一段内容装进一个盒子里，长度按内容算。 */
function boxWith(type: string, content: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + content.length, 0)
  header.write(type, 4, "latin1")
  return Buffer.concat([header, content])
}

/** `size === 1` 的那种盒子：真长度写在后面 8 个字节里。 */
function largeBox(type: string, payloadBytes: number): Buffer {
  const buffer = Buffer.alloc(16 + payloadBytes)
  buffer.writeUInt32BE(1, 0)
  buffer.write(type, 4, "latin1")
  buffer.writeBigUInt64BE(BigInt(buffer.length), 8)
  return buffer
}

/** 按服务端那样取头尾两段，然后把它们交给判定。 */
function inspect(whole: Buffer) {
  const totalBytes = whole.length
  if (totalBytes <= PROBE * 2) {
    return inspectMeetingAudioContainer({ head: whole, tail: null, totalBytes })
  }
  return inspectMeetingAudioContainer({
    head: whole.subarray(0, PROBE),
    tail: whole.subarray(totalBytes - PROBE),
    totalBytes,
  })
}

describe("容器结构判定", () => {
  it("分片 m4a：moov 在最前面，看头一段就够", () => {
    const whole = Buffer.concat([box("ftyp", 20), box("moov", 600), box("moof", 800), box("mdat", 16_000)])
    expect(inspect(whole)).toEqual({ ok: true })
  })

  it("非分片 m4a：moov 收在文件末尾，要看到尾那一段", () => {
    const whole = Buffer.concat([box("ftyp", 20), box("mdat", 150_000), box("moov", 1_000)])
    expect(whole.length).toBeGreaterThan(PROBE * 2)
    expect(inspect(whole)).toEqual({ ok: true })
  })

  it("64 位长度的盒子能跳过去，不会把它当成坏文件", () => {
    const whole = Buffer.concat([box("ftyp", 20), largeBox("mdat", 150_000), box("moov", 900)])
    expect(inspect(whole)).toEqual({ ok: true })
  })

  /**
   * 线上那次真实故障的形状，整个文件按字节抓下来过：`ftyp`（28 字节，合法）之后跟着
   * 一大段零占位——编码器把开头 61413 字节留成占位区，等着停止录音时再补 `moov` 进去，
   * 而上传的字节是在那之前抓的。大小、时长、波形全都正常，只有真去解码才知道坏了。
   */
  it("手机端那次故障的形状：ftyp 之后是一大段零占位，通篇没有 moov", () => {
    const whole = Buffer.concat([box("ftyp", 20), Buffer.alloc(200_000)])
    expect(inspect(whole)).toEqual({ ok: false, reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON })
  })

  it("最后一个 mdat 声明「延伸到文件末尾」，但此前没有索引——那是没有索引", () => {
    const ftyp = box("ftyp", 20)
    const mdat = Buffer.alloc(200_000)
    mdat.writeUInt32BE(0, 0)
    mdat.write("mdat", 4, "latin1")
    expect(inspect(Buffer.concat([ftyp, mdat]))).toEqual({
      ok: false,
      reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON,
    })
  })

  it("盒子的长度小到装不下自己的头，就是坏的", () => {
    const bad = Buffer.alloc(200_000)
    bad.writeUInt32BE(4, 0)
    bad.write("free", 4, "latin1")
    expect(inspect(Buffer.concat([box("ftyp", 20), bad])).ok).toBe(false)
  })

  /**
   * 音频数据里撞上一串碰巧是 "moov" 的字节是有可能的（每 40 亿个位置大约一次）。所以只
   * 认「长度正好补齐到文件末尾」的那一个——那才是真的索引。
   */
  it("数据里碰巧出现 moov 四个字节，但长度对不上，不算数", () => {
    const content = Buffer.alloc(200_000)
    // 在尾部窗口里埋一个假索引：长度写成 500，而它离文件末尾还有别的字节。
    const at = content.length - 100
    content.writeUInt32BE(500, at)
    content.write("moov", at + 4, "latin1")
    // mdat 声明得很长，头部那一段走不完它——必须靠尾部那一段来判断，诱饵才真的被看见。
    const whole = Buffer.concat([box("ftyp", 20), boxWith("mdat", content)])
    expect(whole.length).toBeGreaterThan(PROBE * 2)
    expect(inspect(whole)).toEqual({ ok: false, reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON })
  })

  it("短到连一个盒子头都装不下", () => {
    expect(inspect(Buffer.alloc(4)).ok).toBe(false)
  })

  it("小对象整段都在手上，有 moov 就算完整", () => {
    const whole = Buffer.concat([box("ftyp", 20), box("moov", 60), box("mdat", 200)])
    expect(whole.length).toBeLessThanOrEqual(PROBE * 2)
    expect(inspect(whole)).toEqual({ ok: true })
  })
})

/**
 * `moov/mvhd` 的布局按真实的 108 字节摆：盒子头 8 字节之后是 1 字节 version + 3 字节
 * flags，再往后 creation/modification 两个时间戳，然后才是 `timescale` 和 `duration`。
 * 版本 1 把两个时间戳和时长都加宽成 64 位，`timescale` 跟着往后挪。
 */
function movieHeader(timescale: number, duration: number, version: 0 | 1 = 0): Buffer {
  const content = Buffer.alloc(version === 1 ? 120 : 108)
  content.writeUInt8(version, 0)
  if (version === 1) {
    content.writeUInt32BE(timescale, 20)
    content.writeBigUInt64BE(BigInt(duration), 24)
  } else {
    content.writeUInt32BE(timescale, 12)
    content.writeUInt32BE(duration, 16)
  }
  return boxWith("mvhd", content)
}

function withMovieHeader(timescale: number, duration: number, version: 0 | 1 = 0): Buffer {
  return Buffer.concat([box("ftyp", 20), boxWith("moov", movieHeader(timescale, duration, version)), box("mdat", 400)])
}

describe("从音频里量时长", () => {
  /**
   * 数取自现场那条真实录音：`mvhd` 的 287744/48000 正好是 5.9947 秒，和腾讯云回的
   * `AudioDuration` 5.994688 对得上。量出来的就是这个数，不是按字节估的 13 秒。
   */
  it("读 mvhd 的 duration/timescale", () => {
    expect(readMeetingAudioDurationMs(withMovieHeader(48_000, 287_744))).toBe(5995)
  })

  it("version 1 的 64 位时长也读得出来", () => {
    expect(readMeetingAudioDurationMs(withMovieHeader(1000, 3_600_000, 1))).toBe(3_600_000)
  })

  /**
   * 现场那条「音频文件不完整」的录音：`ftyp` 之后是一大段零占位，通篇没有 `moov`。
   * 量不出来就返回 null，让调用方退回客户端上报的值——这里绝不能返回 0。
   */
  it("没有 moov 就量不出来", () => {
    const broken = Buffer.concat([box("ftyp", 20), Buffer.alloc(8192)])
    expect(readMeetingAudioDurationMs(broken)).toBeNull()
  })

  it("分片 fMP4 的 mvhd 时长是 0，不能当成 0 秒的录音", () => {
    const fragmented = Buffer.concat([box("ftyp", 20), boxWith("moov", movieHeader(1000, 0)), box("moof", 800)])
    expect(readMeetingAudioDurationMs(fragmented)).toBeNull()
  })

  it("moov 写在文件末尾、头部窗口里没有，就量不出来", () => {
    const whole = Buffer.concat([box("ftyp", 20), boxWith("mdat", Buffer.alloc(200_000))])
    expect(readMeetingAudioDurationMs(whole.subarray(0, PROBE))).toBeNull()
  })

  it("头部窗口正好切断 mvhd，也不猜", () => {
    const full = withMovieHeader(48_000, 287_744)
    // 只切到 mvhd 的 version/flags，后面的字段一个都没进来。
    expect(readMeetingAudioDurationMs(full.subarray(0, 28 + 8 + 4))).toBeNull()
  })
})
