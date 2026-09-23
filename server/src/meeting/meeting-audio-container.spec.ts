import { describe, expect, it } from "vitest"

import {
  MEETING_AUDIO_CONTAINER_BROKEN_REASON,
  MEETING_AUDIO_PROBE_BYTES,
  probeMeetingAudio,
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

/**
 * 按服务端那样按需读，读的是内存里的这一份字节。
 *
 * 顺带记下每次读了哪一段：盒子链的价值就在于**读多少字节与录音多长无关**，这条性质得有
 * 断言盯着，否则下次有人把窗口改成「从头读到尾」也不会红。
 */
async function probe(whole: Buffer) {
  const reads: { start: number; end: number }[] = []
  const result = await probeMeetingAudio({
    totalBytes: whole.length,
    readRange: async (start, end) => {
      reads.push({ start, end })
      return whole.subarray(start, end + 1)
    },
  })
  return { ...result, reads }
}

async function inspect(whole: Buffer) {
  return (await probe(whole)).inspection
}

async function measure(whole: Buffer) {
  return (await probe(whole)).durationMs
}

describe("容器结构判定", () => {
  it("分片 m4a：moov 在最前面，看头一段就够", async () => {
    const whole = Buffer.concat([box("ftyp", 20), box("moov", 600), box("moof", 800), box("mdat", 16_000)])
    expect(await inspect(whole)).toEqual({ ok: true })
  })

  it("非分片 m4a：moov 收在文件末尾，要看到尾那一段", async () => {
    const whole = Buffer.concat([box("ftyp", 20), box("mdat", 150_000), box("moov", 1_000)])
    expect(whole.length).toBeGreaterThan(PROBE * 2)
    expect(await inspect(whole)).toEqual({ ok: true })
  })

  it("64 位长度的盒子能跳过去，不会把它当成坏文件", async () => {
    const whole = Buffer.concat([box("ftyp", 20), largeBox("mdat", 150_000), box("moov", 900)])
    expect(await inspect(whole)).toEqual({ ok: true })
  })

  /**
   * 线上那次真实故障的形状，整个文件按字节抓下来过：`ftyp`（28 字节，合法）之后跟着
   * 一大段零占位——编码器把开头 61413 字节留成占位区，等着停止录音时再补 `moov` 进去，
   * 而上传的字节是在那之前抓的。大小、时长、波形全都正常，只有真去解码才知道坏了。
   */
  it("手机端那次故障的形状：ftyp 之后是一大段零占位，通篇没有 moov", async () => {
    const whole = Buffer.concat([box("ftyp", 20), Buffer.alloc(200_000)])
    expect(await inspect(whole)).toEqual({ ok: false, reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON })
  })

  it("最后一个 mdat 声明「延伸到文件末尾」，但此前没有索引——那是没有索引", async () => {
    const ftyp = box("ftyp", 20)
    const mdat = Buffer.alloc(200_000)
    mdat.writeUInt32BE(0, 0)
    mdat.write("mdat", 4, "latin1")
    expect(await inspect(Buffer.concat([ftyp, mdat]))).toEqual({
      ok: false,
      reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON,
    })
  })

  it("盒子的长度小到装不下自己的头，就是坏的", async () => {
    const bad = Buffer.alloc(200_000)
    bad.writeUInt32BE(4, 0)
    bad.write("free", 4, "latin1")
    expect((await inspect(Buffer.concat([box("ftyp", 20), bad]))).ok).toBe(false)
  })

  it("索引声明得比文件还长，那是被截断的，不算完整", async () => {
    // moov 声明 1 MB，实际只有 100 KB —— 传到一半断了的形状。
    const truncated = box("moov", 100_000)
    truncated.writeUInt32BE(1_000_000, 0)
    expect(await inspect(Buffer.concat([box("ftyp", 20), truncated]))).toEqual({
      ok: false,
      reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON,
    })
  })

  /**
   * 音频数据里撞上一串碰巧是 "moov" 的字节是有可能的（每 40 亿个位置大约一次）。老写法在
   * 尾部窗口里搜这四个字母，所以要额外要求「长度正好补齐到文件末尾」来排掉诱饵；现在是按
   * 盒子长度一步一步走过去的，`mdat` 的字节从头到尾都不会被当成盒头读，诱饵根本进不了视野。
   */
  it("数据里碰巧出现 moov 四个字节，不算数", async () => {
    const content = Buffer.alloc(200_000)
    // 在尾部埋一个假索引：长度写成 500，而它离文件末尾还有别的字节。
    const at = content.length - 100
    content.writeUInt32BE(500, at)
    content.write("moov", at + 4, "latin1")
    const whole = Buffer.concat([box("ftyp", 20), boxWith("mdat", content)])
    expect(whole.length).toBeGreaterThan(PROBE * 2)
    expect(await inspect(whole)).toEqual({ ok: false, reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON })
  })

  it("短到连一个盒子头都装不下", async () => {
    expect((await inspect(Buffer.alloc(4))).ok).toBe(false)
  })

  it("小对象整段都在手上，有 moov 就算完整", async () => {
    const whole = Buffer.concat([box("ftyp", 20), box("moov", 60), box("mdat", 200)])
    expect(whole.length).toBeLessThanOrEqual(PROBE * 2)
    expect(await inspect(whole)).toEqual({ ok: true })
  })

  /**
   * **线上那条 85 分钟的录音。** `moov` 的体积随时长线性增长（这条实测 197 字节/秒，
   * 85 分钟是 1,015,794 字节），盒头落在文件末尾往前 1 MB 处。老写法只看最后 64 KB，够不到
   * 盒头，于是把一段完好的录音判成「音频文件不完整」，重试多少次都一样。
   */
  it("长录音：1 MB 的 moov 收在末尾，也要判为完整", async () => {
    const content = Buffer.alloc(41_000_000)
    const whole = Buffer.concat([box("ftyp", 20), boxWith("mdat", content), box("moov", 1_015_786)])
    expect(whole.length).toBeGreaterThan(40 * 1024 * 1024)
    const result = await probe(whole)
    expect(result.inspection).toEqual({ ok: true })
    // 两次读：头一段走到 `mdat` 的末尾，补读的那一段正好落在 `moov` 的盒头上。
    // 41 MB 的 `mdat` 是按它自己声明的长度跳过去的，字节一个都没读。
    const mdatEnd = 28 + 41_000_008
    expect(result.reads).toEqual([
      { start: 0, end: PROBE - 1 },
      { start: mdatEnd, end: mdatEnd + PROBE - 1 },
    ])
  })

  /** 索引前面还夹着别的盒子时，链要能一段一段往前挪，不能只补读一次就下结论。 */
  it("moov 前面隔着一个大 free 盒，也能走到", async () => {
    const whole = Buffer.concat([
      box("ftyp", 20),
      box("free", 100_000),
      box("mdat", 150_000),
      box("moov", 900),
    ])
    expect(await inspect(whole)).toEqual({ ok: true })
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
  it("初始化段在开头时分片形态：读 mvhd 的 duration/timescale", async () => {
    expect(await measure(withMovieHeader(48_000, 287_744))).toBe(5995)
  })

  /**
   * **正常收尾之后桌面端写出来的就是这一种**：`ftyp + mdat + moov`，`moov` 跑到了文件末尾。
   * 老写法靠尾部窗口读它，窗口只有 64 KB，于是长录音一律读不出来、时长悄悄退回客户端上报的
   * 值；现在是走到 `moov` 再读它的第一个子盒子，与 `moov` 多大无关。
   */
  it("收尾后的形状：moov 在末尾，顺着盒子链走过去读", async () => {
    const whole = Buffer.concat([
      box("ftyp", 20),
      boxWith("mdat", Buffer.alloc(200_000)),
      boxWith("moov", movieHeader(48_000, 287_744)),
    ])
    expect(whole.length).toBeGreaterThan(PROBE)
    expect(whole.subarray(0, PROBE).indexOf("moov", 0, "latin1")).toBeLessThan(0)
    expect(await measure(whole)).toBe(5995)
  })

  it("version 1 的 64 位时长也读得出来", async () => {
    expect(await measure(withMovieHeader(1000, 3_600_000, 1))).toBe(3_600_000)
  })

  /**
   * 现场那条「音频文件不完整」的录音：`ftyp` 之后是一大段零占位，通篇没有 `moov`。
   * 量不出来就返回 null，让调用方退回客户端上报的值——这里绝不能返回 0。
   */
  it("没有 moov 就量不出来", async () => {
    expect(await measure(Buffer.concat([box("ftyp", 20), Buffer.alloc(8192)]))).toBeNull()
  })

  /**
   * 进程被杀留下的分片文件：初始化段的 `mvhd` 时长是 0，真实时长分散在各个 `moof` 里。
   * 这种要返回 null 而不是 0——分片形态下没有占位区，客户端按字节估算反而准。
   */
  it("分片 m4a 的 mvhd 时长是 0，不能当成 0 秒的录音", async () => {
    const fragmented = Buffer.concat([box("ftyp", 20), boxWith("moov", movieHeader(1000, 0)), box("moof", 800)])
    expect(await measure(fragmented)).toBeNull()
  })

  it("尾部那串 moov 长度对不上，不算数", async () => {
    // 数据里埋一个假索引：声明长度 500，而它离文件末尾还有别的字节。
    const content = Buffer.alloc(200_000)
    const at = content.length - 100
    content.writeUInt32BE(500, at)
    content.write("moov", at + 4, "latin1")
    const whole = Buffer.concat([box("ftyp", 20), boxWith("mdat", content)])
    expect(await measure(whole)).toBeNull()
  })

  it("索引被截断，不猜时长", async () => {
    const full = withMovieHeader(48_000, 287_744)
    // 只切到 mvhd 的 version/flags，后面的字段一个都没进来。
    expect(await measure(full.subarray(0, 28 + 8 + 4))).toBeNull()
  })
})
