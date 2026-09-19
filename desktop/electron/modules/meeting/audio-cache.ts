import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * 录音音频的本机缓存。
 *
 * 音频本体落在 `userData/meeting-audio-cache/<meetingId>.m4a`，索引是旁边一个
 * `index.json`。**不走 `DataRepository`**：那是给业务数据用的（schema、迁移、备份），
 * 而 `docs/agents/repository-guide.md` 明确禁止把大文件字节写进 DataRepository，音频缓存
 * 又是随时可以重新下载的派生产物——备份它没有意义。`agent-artifacts` 同样是直接写在
 * `userData/` 下的，这里沿用同一个做法。
 *
 * 这一层的总原则：**缓存永远不该让功能挂掉**。索引损坏、文件被手工改坏、删除失败，一律
 * 当作「未命中」或静默跳过，不抛错、不弹提示。所以除了明确标注的几处，所有 IO 错误都
 * 被吞掉并只记日志。
 */

/** 本机最多留多少音频。超过就按「最久没听的」从早到晚删。 */
export const MEETING_AUDIO_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024

const INDEX_FILENAME = "index.json"
const INDEX_VERSION = 1
/** 结尾符 + 数字 + 1 到 3 位数字，`bytes=0-`、`bytes=-500`、`bytes=1000-` 都收。 */
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/

export type MeetingAudioCacheEntry = {
  readonly meetingId: string
  /** 音频字节数。命中判据的一部分：和磁盘上的实际大小不一致就当没缓存。 */
  readonly size: number
  /** 最后一次播放的 ISO 时间。LRU 按它排序。 */
  readonly lastPlayedAt: string
  /** 服务端给的波形数据。跟音频一起缓存，离线时才画得出波形而不是一条平线。 */
  readonly peaks: string
}

export type MeetingAudioCacheLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
}

export type MeetingAudioCacheDeps = {
  readonly root: string
  readonly logger?: MeetingAudioCacheLogger
  readonly limitBytes?: number
}

/** 一条已确认可用的缓存：文件路径 + 随它一起缓存的波形。 */
export type CachedMeetingAudio = {
  readonly path: string
  readonly peaks: string
}

export type ByteRange = { readonly start: number; readonly end: number }

/**
 * 解析 `Range` 头。
 *
 * 返回 `null` 表示没有区间（按整体 200 回），`"unsatisfiable"` 表示区间越界（回 416）。
 * 播放器拖动进度条靠它——不解析的话 `<audio>` 会拿到一个不能定位的响应：波形照画，
 * 进度条拖不动，而且不报错。
 */
export function parseByteRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null
  const match = RANGE_PATTERN.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === "" && rawEnd === "") return null

  let start: number
  let end: number
  if (rawStart === "") {
    // 后缀区间：`bytes=-N` 是最后 N 字节。
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable"
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start >= size) return "unsatisfiable"
  if (end < start) return "unsatisfiable"
  return { start, end }
}

/** meetingId 只用来拼文件名，所以这里同时是防目录穿越的那道闸。 */
export function isSafeMeetingId(meetingId: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(meetingId)
}

/**
 * 本机音频交给渲染进程用的特权协议。
 *
 * 放在这个文件里而不是协议处理器那边：渲染进程拿到的地址由这里生成，主进程服务它的
 * 时候也由这里解析，两边共用同一份拼装规则才不会对不上。
 */
export const MEETING_AUDIO_PROTOCOL_SCHEME = "synapse-meeting-audio"
const MEETING_AUDIO_PROTOCOL_HOST = "local"

export function meetingAudioUrlForId(meetingId: string): string {
  return `${MEETING_AUDIO_PROTOCOL_SCHEME}://${MEETING_AUDIO_PROTOCOL_HOST}/${encodeURIComponent(meetingId)}`
}

/** 解析不出合法 id 就返回 null —— 协议处理器据此回 404，不落到文件系统上。 */
export function resolveMeetingAudioUrlId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEETING_AUDIO_PROTOCOL_SCHEME}:`) return null
  if (parsed.hostname !== MEETING_AUDIO_PROTOCOL_HOST) return null
  const segments = parsed.pathname.split("/").filter(Boolean)
  if (segments.length !== 1) return null
  let meetingId: string
  try {
    meetingId = decodeURIComponent(segments[0])
  } catch {
    return null
  }
  return isSafeMeetingId(meetingId) ? meetingId : null
}

export function meetingAudioCacheRoot(userDataPath: string): string {
  return path.join(userDataPath, "meeting-audio-cache")
}

export function createMeetingAudioCache(deps: MeetingAudioCacheDeps) {
  const root = deps.root
  const limitBytes = deps.limitBytes ?? MEETING_AUDIO_CACHE_LIMIT_BYTES

  function audioPath(meetingId: string): string {
    return path.join(root, `${meetingId}.m4a`)
  }

  function indexPath(): string {
    return path.join(root, INDEX_FILENAME)
  }

  function warn(message: string, error: unknown, meta: Record<string, unknown> = {}): void {
    deps.logger?.warn(message, {
      ...meta,
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }

  /**
   * 读索引。
   *
   * **任何异常都当作空缓存**——文件不存在、JSON 坏了、版本对不上，结果都一样：没有可用
   * 的缓存，需要的东西重新下。缓存坏了不该让播放挂掉。
   */
  async function readEntries(): Promise<readonly MeetingAudioCacheEntry[]> {
    let raw: string
    try {
      raw = await readFile(indexPath(), "utf8")
    } catch {
      // 文件不存在是常态（一次都没缓存过），不用记日志。
      return []
    }
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown }
      if (parsed.version !== INDEX_VERSION || !Array.isArray(parsed.entries)) return []
      return (parsed.entries as MeetingAudioCacheEntry[]).filter(
        (entry) =>
          typeof entry?.meetingId === "string" &&
          isSafeMeetingId(entry.meetingId) &&
          typeof entry.size === "number" &&
          Number.isFinite(entry.size) &&
          entry.size >= 0 &&
          typeof entry.lastPlayedAt === "string" &&
          typeof entry.peaks === "string",
      )
    } catch (error) {
      warn("Meeting audio cache index is unreadable; treating as empty.", error)
      return []
    }
  }

  /** 原子的写：先写临时文件再 rename，中途被杀不会留下半个 JSON。 */
  async function writeEntries(entries: readonly MeetingAudioCacheEntry[]): Promise<void> {
    const temporary = `${indexPath()}.tmp`
    try {
      await mkdir(root, { recursive: true })
      await writeFile(temporary, JSON.stringify({ version: INDEX_VERSION, entries }), "utf8")
      await rename(temporary, indexPath())
    } catch (error) {
      warn("Meeting audio cache index write failed.", error)
      try {
        await unlink(temporary)
      } catch (cleanupError) {
        // 临时文件没删掉不影响任何功能，下一次写会覆盖它。
        warn("Meeting audio cache temp index cleanup failed.", cleanupError)
      }
    }
  }

  function upsert(
    entries: readonly MeetingAudioCacheEntry[],
    entry: MeetingAudioCacheEntry,
  ): readonly MeetingAudioCacheEntry[] {
    return [...entries.filter((existing) => existing.meetingId !== entry.meetingId), entry]
  }

  async function unlinkQuietly(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
    } catch (error) {
      // 文件本来就不在是最常见的情况；删不掉（被占用等）也只是白占空间，下次清理再试。
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        warn("Meeting audio cache file removal failed.", error, { filePath: path.basename(filePath) })
      }
    }
  }

  /** 文件在不在，在的话多大。读不到就是不在。 */
  async function fileSize(filePath: string): Promise<number | null> {
    try {
      const stats = await stat(filePath)
      return stats.isFile() ? stats.size : null
    } catch {
      return null
    }
  }

  /**
   * 查一条缓存能不能直接用。
   *
   * 命中判据是三件套：文件在 **且** 磁盘大小等于索引里记的 size **且** 等于服务端这次的
   * `recording.size`。有任一不符就当没缓存——文件被截断、被换掉、服务端重新编码过，都
   * 走这条。
   */
  async function lookup(meetingId: string, serverSize: number): Promise<CachedMeetingAudio | null> {
    if (!isSafeMeetingId(meetingId)) return null
    const entries = await readEntries()
    const entry = entries.find((candidate) => candidate.meetingId === meetingId)
    if (!entry) return null
    if (serverSize > 0 && entry.size !== serverSize) return null
    const actualSize = await fileSize(audioPath(meetingId))
    if (actualSize === null || actualSize !== entry.size) return null
    return { path: audioPath(meetingId), peaks: entry.peaks }
  }

  /**
   * 只取波形，不碰音频文件。
   *
   * 波形跟音频一起缓存，但取波形的那次调用与播放是并行的：音频还没下完、甚至这条音频
   * 已经被淘汰，只要索引里记着波形就照给——波形只是一条线，比拿不到时画一条平线强。
   */
  async function peaksFor(meetingId: string): Promise<string | null> {
    if (!isSafeMeetingId(meetingId)) return null
    const entries = await readEntries()
    const entry = entries.find((candidate) => candidate.meetingId === meetingId)
    return entry && entry.peaks.length > 0 ? entry.peaks : null
  }

  /** 记下一条已经完整落盘的音频。`lastPlayedAt` 由调用方给，收尾和播放共用一处时间源。 */
  async function save(input: {
    readonly meetingId: string
    readonly size: number
    readonly peaks: string
    readonly lastPlayedAt: string
  }): Promise<void> {
    if (!isSafeMeetingId(input.meetingId)) return
    const entries = await readEntries()
    await writeEntries(upsert(entries, input))
  }

  /** 播放开始时把这条挪到 LRU 队尾。 */
  async function touch(meetingId: string, playedAt: string): Promise<void> {
    if (!isSafeMeetingId(meetingId)) return
    const entries = await readEntries()
    const entry = entries.find((candidate) => candidate.meetingId === meetingId)
    if (!entry) return
    await writeEntries(upsert(entries, { ...entry, lastPlayedAt: playedAt }))
  }

  /** 音频和索引条目一起删。用户在本机删掉这条录音时走这里。 */
  async function remove(meetingId: string): Promise<void> {
    if (!isSafeMeetingId(meetingId)) return
    const entries = await readEntries()
    const remaining = entries.filter((entry) => entry.meetingId !== meetingId)
    if (remaining.length === entries.length) return
    await unlinkQuietly(audioPath(meetingId))
    await writeEntries(remaining)
  }

  /**
   * 清掉「本机有、这次列表里没有」的那些。
   *
   * **`complete` 为 false 时一律不判**：列表满上限说明还有更早的没返回，那些不在列表里
   * 的其实是没返回，照这个规则会把它们误删。只有返回条数少于上限，才说明服务端把所有
   * 录音都给全了。
   */
  async function pruneMissing(presentIds: readonly string[], complete: boolean): Promise<void> {
    if (!complete) return
    const entries = await readEntries()
    if (entries.length === 0) return
    const present = new Set(presentIds)
    const missing = entries.filter((entry) => !present.has(entry.meetingId))
    if (missing.length === 0) return
    for (const entry of missing) await unlinkQuietly(audioPath(entry.meetingId))
    await writeEntries(entries.filter((entry) => present.has(entry.meetingId)))
  }

  /**
   * 总量超上限时按「最后一次播放时间」从早到晚删，直到降回上限。
   *
   * 返回被删掉的 meetingId，方便调用方（和测试）知道发生了什么。总量本来就够小的时候
   * 一次磁盘写都不会发生。
   */
  async function enforceLimit(): Promise<readonly string[]> {
    const entries = await readEntries()
    let total = entries.reduce((sum, entry) => sum + entry.size, 0)
    if (total <= limitBytes) return []

    const oldestFirst = [...entries].sort((left, right) => left.lastPlayedAt.localeCompare(right.lastPlayedAt))
    const survivors = [...entries]
    const evicted: string[] = []
    for (const entry of oldestFirst) {
      if (total <= limitBytes) break
      total -= entry.size
      evicted.push(entry.meetingId)
      await unlinkQuietly(audioPath(entry.meetingId))
      const at = survivors.findIndex((candidate) => candidate.meetingId === entry.meetingId)
      if (at >= 0) survivors.splice(at, 1)
    }
    if (evicted.length === 0) return []
    await writeEntries(survivors)
    return evicted
  }

  /** 缓存目录整个抹掉。目前只有测试用得到，留着是为了不让测试去摸私有字段。 */
  async function clearAll(): Promise<void> {
    try {
      await rm(root, { recursive: true, force: true })
    } catch (error) {
      warn("Meeting audio cache clear failed.", error)
    }
  }

  return {
    root,
    audioPath,
    lookup,
    peaksFor,
    save,
    touch,
    remove,
    pruneMissing,
    enforceLimit,
    clearAll,
  }
}

export type MeetingAudioCache = ReturnType<typeof createMeetingAudioCache>
