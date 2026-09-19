/**
 * 一段录音的容器写得完不完整。
 *
 * 起因是一次真实故障：手机端在停止录音之前就把字节整批传完了，上传的对象开头是一段
 * 61413 字节的零占位、通篇也没有 `moov`——播放器打不开，识别引擎只回一句
 * `Invalid audio file!`。这种文件**大小、时长、波形全都正常**，只有真去解码的时候才
 * 知道它坏了，所以在收尾的时候看得出来很重要。
 *
 * 上传收尾之后先在这里看一眼，**不下载整个对象**：非分片的 m4a 把 `moov` 放在最后，
 * 分片的 fMP4 把它放在最前，头尾各看一段就够覆盖两种写法。
 *
 * 它防的不只是手机端这一次，是**任何一个端的容器缺陷**——包括还没有的那些端。
 *
 * 边界要说清楚：这里只判断「容器结构写完了没有」，**不判断音频内容**。过了这一关的
 * 文件仍然可能被识别引擎拒绝（采样率不对、没有声音都算），那些交给引擎去说。这里挡住
 * 的只是「结构上根本不可能被读出来」这一类，让用户一分钟内看到原因，而不是白等一轮轮询。
 */

/** 头尾各探测多少字节。`moov` 的头部几十 KB 就够，尾部同理。 */
export const MEETING_AUDIO_PROBE_BYTES = 64 * 1024

/** 展示给用户的失败原因。这类失败是终局，重试同一份字节不会变。 */
export const MEETING_AUDIO_CONTAINER_BROKEN_REASON = "这段录音的音频文件不完整，无法转写。"

const BOX_HEADER_BYTES = 8
const LARGE_SIZE_HEADER_BYTES = 16

export type MeetingAudioInspection = { readonly ok: true } | { readonly ok: false; readonly reason: string }

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

function readLargeBoxSize(buffer: Buffer, offset: number): number | null {
  if (offset + LARGE_SIZE_HEADER_BYTES > buffer.length) return null
  const size = buffer.readBigUInt64BE(offset + BOX_HEADER_BYTES)
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(size)
}

/**
 * 看这段录音的容器写完没有。
 *
 * - `head`：对象开头的一段；对象比探测窗口还小时就是全部。
 * - `tail`：对象结尾的一段。和 `head` 重叠、或者对象本身就短到全在 `head` 里时传 `null`，
 *   这时按「整个对象都在这儿」来判断。
 */
export function inspectMeetingAudioContainer(input: {
  readonly head: Buffer
  readonly tail: Buffer | null
  readonly totalBytes: number
}): MeetingAudioInspection {
  const { head, tail, totalBytes } = input
  const broken: MeetingAudioInspection = { ok: false, reason: MEETING_AUDIO_CONTAINER_BROKEN_REASON }
  if (!Number.isFinite(totalBytes) || totalBytes < BOX_HEADER_BYTES) return broken

  // 从头走盒子链。分片 fMP4 的 `moov`（init segment）就在最前面，走到它就够了。
  let offset = 0
  while (offset < totalBytes && offset + BOX_HEADER_BYTES <= head.length) {
    const box = readBoxHeader(head, offset)
    if (!box) break
    if (box.type === "moov" || box.type === "moof") return { ok: true }
    if (box.size === 0) {
      // 「延伸到文件末尾」只对最后一个 mdat 合法，而它后面不可能再有任何盒子——走到这里
      // 说明索引要么已经在前面（上面就返回了），要么根本不存在。
      return broken
    }
    if (box.size === 1) {
      const large = readLargeBoxSize(head, offset)
      if (large === null || large < LARGE_SIZE_HEADER_BYTES) return broken
      offset += large
      continue
    }
    if (box.size < BOX_HEADER_BYTES) return broken
    offset += box.size
  }

  // 整个对象都在手上，却一路没撞见索引，那就是没有。
  if (!tail) return broken

  // 非分片的 m4a 把 `moov` 放在最后。只认**正好收在文件末尾**的那一个：音频数据里撞上
  // 一串碰巧是 "moov" 的字节是有可能的，而「它的长度正好补齐到文件末尾」不是碰巧。
  const tailStart = totalBytes - tail.length
  let searchFrom = 0
  while (searchFrom <= tail.length - 4) {
    const at = tail.indexOf("moov", searchFrom, "latin1")
    if (at < 0) break
    searchFrom = at + 1
    if (at < 4) continue
    const size = tail.readUInt32BE(at - 4)
    if (size >= BOX_HEADER_BYTES && tailStart + at - 4 + size === totalBytes) return { ok: true }
  }
  return broken
}
