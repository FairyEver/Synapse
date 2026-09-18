import type { RawSentenceDetail } from "./tencent-asr"

/**
 * 把腾讯云返回的识别结果翻成落库用的段落。
 *
 * 这个文件里的字段名全部来自真实返回，不是推测：`ResTextFormat=1` 的结构化结果在
 * `ResultDetail` 里，不在 `Result` 里；`Result` 往往仍是整段文本，只读它会得到一堆
 * 没有时间戳、没有说话人的连续文字。
 *
 * 两条兜底：
 * - `ResultDetail` 缺失时退回解析 `Result` 的行格式（`[起,止,说话人] 文本`），
 *   老任务和降级返回都走得通。
 * - 词级时间戳的偏移是**相对本句**的，落库前要加上句子的 `StartMs` 换成绝对时间。
 */

export type ParsedTranscriptWord = {
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

export type ParsedTranscriptSegment = {
  readonly speakerId: number
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly words: readonly ParsedTranscriptWord[]
}

export type ParsedTranscript = {
  readonly segments: readonly ParsedTranscriptSegment[]
  readonly speakerCount: number
}

const EMPTY_TRANSCRIPT: ParsedTranscript = { segments: [], speakerCount: 0 }

/**
 * 纯文本行：`[0:0.420,0:1.120,0]  啊。`
 *
 * 时间是「分:秒.毫秒」，不是毫秒；说话人是最后那个整数。
 */
const PLAIN_LINE_PATTERN = /^\[(\d+):(\d+(?:\.\d+)?),(\d+):(\d+(?:\.\d+)?),(\d+)\]\s*(.*)$/u

function clockToMs(minutes: string, seconds: string): number {
  return Math.round((Number(minutes) * 60 + Number(seconds)) * 1000)
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function segmentFromDetail(detail: RawSentenceDetail): ParsedTranscriptSegment | null {
  const text = normalizeText(detail.FinalSentence)
  if (!text) return null
  const startMs = Math.max(0, Math.round(toFiniteNumber(detail.StartMs)))
  const endMs = Math.max(startMs, Math.round(toFiniteNumber(detail.EndMs, startMs)))
  const words: ParsedTranscriptWord[] = []
  for (const word of detail.Words ?? []) {
    const wordText = normalizeText(word.Word)
    if (!wordText) continue
    // 相对偏移必须加上句子起点，否则整篇的字幕都会堆在 0 秒附近。
    const wordStart = startMs + Math.max(0, Math.round(toFiniteNumber(word.OffsetStartMs)))
    words.push({
      text: wordText,
      startMs: wordStart,
      endMs: Math.max(wordStart, startMs + Math.round(toFiniteNumber(word.OffsetEndMs, wordStart - startMs))),
    })
  }
  return {
    speakerId: Math.max(0, Math.round(toFiniteNumber(detail.SpeakerId))),
    startMs,
    endMs,
    text,
    words,
  }
}

function parsePlainText(result: string): ParsedTranscript {
  const segments: ParsedTranscriptSegment[] = []
  for (const line of result.split("\n")) {
    const match = PLAIN_LINE_PATTERN.exec(line.trim())
    if (!match) continue
    const startMs = clockToMs(match[1], match[2])
    const endMs = Math.max(startMs, clockToMs(match[3], match[4]))
    const text = match[6].trim()
    if (!text) continue
    segments.push({
      speakerId: Math.max(0, Number(match[5])),
      startMs,
      endMs,
      text,
      words: [],
    })
  }
  return finalize(segments)
}

function finalize(segments: readonly ParsedTranscriptSegment[]): ParsedTranscript {
  const ordered = [...segments].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
  const speakers = new Set<number>()
  for (const segment of ordered) speakers.add(segment.speakerId)
  return { segments: ordered, speakerCount: speakers.size }
}

/**
 * `raw` 是 `DescribeTaskStatus` 的 `Data.Result`。
 *
 * 传进来的可能是一段 JSON、一段纯文本行、空串或 null，四种都要能处理——任务成功的
 * 状态码和「有没有内容」是两件事，静音录音就是一个合法的空结果。
 */
export function parseTencentTranscript(raw: string | null | undefined): ParsedTranscript {
  if (!raw || !raw.trim()) return EMPTY_TRANSCRIPT
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 不是 JSON：按纯文本行格式试一次，还解析不出就当作没有内容。
    return parsePlainText(raw)
  }

  if (typeof parsed === "string") return parsePlainText(parsed)
  if (!parsed || typeof parsed !== "object") return EMPTY_TRANSCRIPT

  const detail = (parsed as { ResultDetail?: unknown }).ResultDetail
  if (Array.isArray(detail)) {
    const segments: ParsedTranscriptSegment[] = []
    for (const item of detail) {
      if (!item || typeof item !== "object") continue
      const segment = segmentFromDetail(item as RawSentenceDetail)
      if (segment) segments.push(segment)
    }
    if (segments.length > 0) return finalize(segments)
  }

  const result = (parsed as { Result?: unknown }).Result
  if (typeof result === "string") return parsePlainText(result)
  return EMPTY_TRANSCRIPT
}
