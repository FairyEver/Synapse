import type { MeetingTranscriptSegmentDto } from "@synapse/shared"

/**
 * 转写文字排版。
 *
 * 腾讯云按句返回，一句一行读起来像流水账。这里把句子顺着并下去，够了大约一段的篇幅
 * 才断一次，读起来才像一篇文章。
 *
 * 手机端按同一套规则分段（`MeetingText`），两端看起来才是同一份东西。
 */

/** 一段大约多少字。 */
export const TRANSCRIPT_PARAGRAPH_CHARS = 110

export function joinTranscriptParagraphs(segments: readonly MeetingTranscriptSegmentDto[]): string[] {
  const paragraphs: string[] = []
  let current = ""
  for (const segment of segments) {
    current += segment.text
    if (current.length >= TRANSCRIPT_PARAGRAPH_CHARS) {
      paragraphs.push(current)
      current = ""
    }
  }
  if (current) paragraphs.push(current)
  return paragraphs
}
