/**
 * 一段录音的容器写得完不完整，以及它的真实时长。
 *
 * 起因是一次真实故障：手机端在停止录音之前就把字节整批传完了，上传的对象开头是一段
 * 61413 字节的零占位、通篇也没有 `moov`——播放器打不开，识别引擎只回一句
 * `Invalid audio file!`。这种文件**大小、时长、波形全都正常**，只有真去解码的时候才
 * 知道它坏了，所以在收尾的时候看得出来很重要。
 *
 * 判定方式是**从第一个字节起沿盒子链走**：走到 `moov`（索引本身）或 `moof`（分片形态
 * 的碎片）就是完整。不要退回「读头尾各 64 KB，在尾部窗口里搜 `moov` 盒头」那条老路
 * ——它对长录音是错的：`moov` 的体积随时长线性增长（实测 197 字节/秒，一场 85 分钟的
 * 会是 1 MB），盒头落在文件末尾往前 1 MB 处，64 KB 的窗口够不到，于是一段完好的录音被
 * 判成「音频文件不完整」，重试多少次都一样。走盒子链没有这个问题：大块的 `mdat` 是按
 * 它自己声明的长度**算术跳过**的，不读它的内容，所以读多少字节与录音多长无关，只与
 * 「索引之前有几个盒子」有关。
 *
 * 也正因为位置是按盒子长度算出来的、不是在一堆字节里搜出来的，这里不再需要「`moov`
 * 正好收在文件末尾」那条防误判的补充条件：顺着链走到 `moov`，那它就是真的索引。
 *
 * 边界要说清楚：这里只判断「容器结构写完了没有」，**不判断音频内容**。过了这一关的
 * 文件仍然可能被识别引擎拒绝（采样率不对、没有声音都算），那些交给引擎去说。这里挡住
 * 的只是「结构上根本不可能被读出来」这一类，让用户一分钟内看到原因，而不是白等一轮轮询。
 *
 * 整个模块不碰 IO：要看哪一段字节由调用方通过 `readRange` 送进来。
 */

/** 每次补读的窗口大小。`moov` 之前的盒子都很小，一窗足够走完好几个。 */
export const MEETING_AUDIO_PROBE_BYTES = 64 * 1024

/** 一次探测最多补读几次。合法文件用不到两次：盒子链会算术跳过大块的 `mdat`。 */
const MAX_PROBE_READS = 8

/** 展示给用户的失败原因。这类失败是终局，重试同一份字节不会变。 */
export const MEETING_AUDIO_CONTAINER_BROKEN_REASON = "这段录音的音频文件不完整，无法转写。"

const BOX_HEADER_BYTES = 8
const LARGE_SIZE_HEADER_BYTES = 16

/** `mvhd` 最长也就 120 字节（version 1 的 64 位形态），放在一个盒头之后一起读。 */
const MOVIE_HEADER_MAX_BYTES = 128

export type MeetingAudioInspection = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** 「索引盒」的位置：`moov` 的盒头在对象里的绝对偏移与它声明的长度。 */
type MeetingAudioIndexBox = { readonly offset: number; readonly size: number }

/** 已经读到的一段字节，以及它在对象里的绝对偏移。 */
type MeetingAudioSegment = { readonly offset: number; readonly bytes: Buffer }

/** 读对象里 `[start, end]` 的一段字节，两端都含在内。 */
export type MeetingAudioRangeReader = (start: number, end: number) => Promise<Buffer>

export type MeetingAudioProbe = {
  /** 容器结构判定。 */
  readonly inspection: MeetingAudioInspection
  /**
   * `moov/mvhd` 量出来的真实时长。
   *
   * **客户端上报的时长只当参考。** 现场撞到过一条 6 秒的录音上报 0 秒（录音器的
   * `currentTime` 读成了 0），而按文件字节估出来的又必然偏大——老写法下 m4a 开头那段约
   * 60 KB 的占位区不是音频，按总字节数折算会把一条 6 秒的录音算成 13 秒。文件本身才是最
   * 可靠的来源。
   *
   * 读的是 `moov/mvhd`：`duration / timescale` 与识别引擎报的时长分毫不差（实测一条
   * 287744/48000 = 5.9947 秒的录音，腾讯云回的 `AudioDuration` 正是 5.994688）。
   *
   * 量不出来时为 `null`，调用方退回客户端上报的值。已知量不出来的情形：分片 m4a 的
   * 初始化 `mvhd` 时长是 0（真实时长分散在各个 `moof` 里），以及结构被判为不完整的文件。
   * 这种不猜——「进程被杀」那条路上分片形态没有占位区，客户端的按字节估算反而准。
   */
  readonly durationMs: number | null
}

type Box = { readonly type: string; readonly size: number }

/**
 * 读一个盒子的头。
 *
 * `size === 1` 表示真的长度在后面 8 个字节里（64 位）；`size === 0` 表示「一直延伸到
 * 文件末尾」，只对最后一个盒子合法。
 */
function readBoxHeader(buffer: Buffer, offset: number): Box | null {
  if (offset + BOX_HEADER_BYTES > buffer.length) return null
  const type = buffer.toString("latin1", offset + 4, offset + 8)
  const raw = buffer.readUInt32BE(offset)
  if (raw === 0 || raw === 1) return { type, size: raw }
  return { type, size: raw }
}

/** 在已经读到的字节里取 `[offset, offset + length)`；手边没有就回 `null`，由调用方补读。 */
function findBytes(segments: readonly MeetingAudioSegment[], offset: number, length: number): Buffer | null {
  for (const segment of segments) {
    const relative = offset - segment.offset
    if (relative < 0) continue
    if (relative + length > segment.bytes.length) continue
    return segment.bytes.subarray(relative, relative + length)
  }
  return null
}

type BoxChainStep =
  | { readonly kind: "read"; readonly offset: number }
  | { readonly kind: "decided"; readonly inspection: MeetingAudioInspection; readonly index: MeetingAudioIndexBox | null }

/**
 * 从对象开头沿盒子链走一遍，只看已经读到的字节。
 *
 * 走到还没读过的位置就回一个「请读 `offset` 处」的请求；走出结论就回 `decided`。每次调用
 * 都从头重走一遍——盒子链一共也没几个盒子，而这样这个函数是无状态的，好测。
 */
function scanBoxChain(totalBytes: number, segments: readonly MeetingAudioSegment[]): BoxChainStep {
  const broken = (): BoxChainStep => ({
    kind: "decided",
    inspection: { ok: false, reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON },
    index: null,
  })

  let offset = 0
  while (offset < totalBytes) {
    const header = findBytes(segments, offset, BOX_HEADER_BYTES)
    if (!header) return { kind: "read", offset }
    const type = header.toString("latin1", 4, BOX_HEADER_BYTES)
    const declared = header.readUInt32BE(0)

    let size = declared
    if (declared === 0) {
      // 「延伸到文件末尾」只对最后一个 `mdat` 合法，而它后面不可能再有任何盒子——走到这里
      // 说明索引要么已经在前面（上面就返回了），要么根本不存在。
      return broken()
    }
    if (declared === 1) {
      const wide = findBytes(segments, offset, LARGE_SIZE_HEADER_BYTES)
      if (!wide) return { kind: "read", offset }
      const large = wide.readBigUInt64BE(BOX_HEADER_BYTES)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return broken()
      size = Number(large)
      if (size < LARGE_SIZE_HEADER_BYTES) return broken()
    } else if (size < BOX_HEADER_BYTES) {
      return broken()
    }

    // 索引盒就是结论：`moov` 是索引本身，分片形态下每 2 秒一个的 `moof` 也够。这里唯一的
    // 额外要求是它声明得下——声明越过文件末尾就是被截断了，那样的索引读不出来。
    if (type === "moov" || type === "moof") {
      if (offset + size > totalBytes) return broken()
      return {
        kind: "decided",
        inspection: { ok: true },
        index: type === "moov" ? { offset, size } : null,
      }
    }

    offset += size
  }

  // 整条链自洽地走到了文件末尾，却没撞见索引。声明越过文件末尾的盒子也在这里收敛：`offset`
  // 直接跳过 `totalBytes`，循环条件不再成立。
  return broken()
}

/**
 * 在 `moov` 内部找 `mvhd` 并算出时长。
 *
 * `buffer` 从 `moov` 的盒头开始，`size` 是这个盒子声明的总长度（含盒头）。
 */
function readMoovDuration(buffer: Buffer, size: number): number | null {
  const limit = Math.min(size, buffer.length)
  let offset = BOX_HEADER_BYTES
  while (offset + BOX_HEADER_BYTES <= limit) {
    const box = readBoxHeader(buffer, offset)
    if (!box) return null
    if (box.type === "mvhd") return readMvhdDuration(buffer, offset)
    if (box.size < BOX_HEADER_BYTES) return null
    offset += box.size
  }
  return null
}

/** `mvhd` 的时长是 32 位里的这个值时表示「未知」，不是真的这么长。 */
const UNKNOWN_DURATION_32 = 0xffffffff

/**
 * `mvhd` 的 `duration / timescale`。
 *
 * 布局随 `version` 变：version 1 把两个时间戳和时长都加宽成 64 位，`timescale` 的位置
 * 也跟着挪。长度不够就返回 `null`——读进来的窗口是按块切的，理论上可能正好切断 `mvhd`。
 */
function readMvhdDuration(buffer: Buffer, offset: number): number | null {
  const versionOffset = offset + BOX_HEADER_BYTES
  if (versionOffset + 4 > buffer.length) return null
  const version = buffer.readUInt8(versionOffset)
  // 跳过 1 字节 version + 3 字节 flags。
  const body = versionOffset + 4

  let timescale: number
  let duration: number
  if (version === 1) {
    if (body + 28 > buffer.length) return null
    timescale = buffer.readUInt32BE(body + 16)
    const raw = buffer.readBigUInt64BE(body + 20)
    if (raw > BigInt(Number.MAX_SAFE_INTEGER)) return null
    duration = Number(raw)
  } else {
    if (body + 16 > buffer.length) return null
    timescale = buffer.readUInt32BE(body + 8)
    duration = buffer.readUInt32BE(body + 12)
  }

  if (timescale <= 0) return null
  // 0 和全 1 都不是时长：前者是空轨，后者是「未知」。
  if (duration <= 0 || duration === UNKNOWN_DURATION_32) return null
  return Math.round((duration / timescale) * 1000)
}

/**
 * 看这段录音的容器写完没有，顺量表一下真实时长。
 *
 * **只读需要的那几段**，绝不下载整个对象：一场五小时的是 140 MB，而我们除了盒头什么都不
 * 需要。补读的起点由盒子链自己算出来（`mdat` 是按声明长度跳过去的），所以读多少字节与录音
 * 多长无关。
 */
export async function probeMeetingAudio(input: {
  readonly readRange: MeetingAudioRangeReader
  readonly totalBytes: number
}): Promise<MeetingAudioProbe> {
  const { readRange, totalBytes } = input
  const rejected = (): MeetingAudioProbe => ({
    inspection: { ok: false, reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON },
    durationMs: null,
  })
  if (!Number.isFinite(totalBytes) || totalBytes < BOX_HEADER_BYTES) return rejected()

  const segments: MeetingAudioSegment[] = []
  const fetchWindow = async (offset: number): Promise<void> => {
    const end = Math.min(totalBytes, offset + MEETING_AUDIO_PROBE_BYTES) - 1
    segments.push({ offset, bytes: await readRange(offset, end) })
  }
  /** 取 `[offset, offset + length)` 的字节；手边没有就补读一段。 */
  const bytesAt = async (offset: number, length: number): Promise<Buffer | null> => {
    const ready = findBytes(segments, offset, length)
    if (ready) return ready
    await fetchWindow(offset)
    return findBytes(segments, offset, length)
  }

  await fetchWindow(0)
  for (let attempt = 0; attempt <= MAX_PROBE_READS; attempt += 1) {
    const step = scanBoxChain(totalBytes, segments)
    if (step.kind === "decided") {
      if (!step.inspection.ok) return { inspection: step.inspection, durationMs: null }
      if (!step.index) return { inspection: step.inspection, durationMs: null }
      // `mvhd` 是 `moov` 的第一个子盒子，跟着盒头一起读进来就够。
      const window = await bytesAt(step.index.offset, Math.min(step.index.size, MOVIE_HEADER_MAX_BYTES))
      return {
        inspection: step.inspection,
        durationMs: window ? readMoovDuration(window, step.index.size) : null,
      }
    }
    await fetchWindow(step.offset)
  }

  // 链一直没走完（盒子多到不合常理）：按「读不完就不敢放行」处理。
  return rejected()
}
