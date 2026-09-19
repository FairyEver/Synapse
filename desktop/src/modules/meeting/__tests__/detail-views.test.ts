import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import type { MeetingTranscriptSegmentDto } from "@synapse/shared"

import { joinTranscriptParagraphs } from "../transcript-paragraphs"

function segment(text: string): MeetingTranscriptSegmentDto {
  return { id: text.slice(0, 8), speakerId: 0, startMs: 0, endMs: 0, text, words: [] }
}

/** 源码级的检查：这两样东西一旦重新长回界面里，下面这些用例会立刻变红。 */
async function moduleSource(file: string): Promise<string> {
  return readFile(new URL(`../${file}`, import.meta.url), "utf8")
}

describe("文字视图", () => {
  it("把句子并成自然段，不是一句一行", () => {
    const sentence = "这是一句四十五个字左右的话，用来把一段撑到足够长以便观察分段的结果。"
    const paragraphs = joinTranscriptParagraphs([segment(sentence), segment(sentence), segment(sentence)])
    // 一句一段的流水账会得到三段；并成自然段之后只有一段。
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0]).toBe(sentence.repeat(3))
  })

  it("够了一段就断开，不会把整场录音堆成一段", () => {
    const sentence = "这是一句四十五个字左右的话，用来把一段撑到足够长以便观察分段的结果。"
    const paragraphs = joinTranscriptParagraphs(
      Array.from({ length: 9 }, () => segment(sentence)),
    )
    expect(paragraphs.length).toBeGreaterThan(1)
    // 最后一段是剩下的尾巴，可以短；前面的每一段都必须够长。
    for (const paragraph of paragraphs.slice(0, -1)) {
      expect(paragraph.length).toBeGreaterThanOrEqual(110)
    }
  })

  it("短录音不会被切碎，一句话就是一段", () => {
    expect(joinTranscriptParagraphs([segment("测一下能不能录上。")])).toEqual(["测一下能不能录上。"])
  })

  it("一个字都没有时返回空数组，由界面去说「还没有文字」", () => {
    expect(joinTranscriptParagraphs([])).toEqual([])
  })
})

describe("右栏只剩语音和文字两个视图", () => {
  it("文字视图里没有纪要、发言人、逐字稿和时间戳", async () => {
    const source = await moduleSource("meeting-detail-view.tsx")
    // 查的是渲染用的标识符而不是说明文字：注释里写「没有纪要」是交代为什么它不在，
    // 而下面这些东西一旦出现，就是它真的回到了界面上。
    for (const symbol of [
      "MeetingMinutesView",
      "SpeakerNamingDialog",
      "speakerId",
      "startMs",
      "minutesStatus",
      "minutesFailureReason",
      "Search",
    ]) {
      expect(source).not.toContain(symbol)
    }
    // 两个视图就是两个：多出第三个入口说明有东西又长回来了。
    expect(source.match(/<TabsTrigger/g)).toHaveLength(2)
  })

  it("回放波形取值时就还原成 0-1，不把服务端存的字节直接当振幅画", async () => {
    const source = await moduleSource("meeting-playback.tsx")
    // 少了这一步不会报任何错，只会让每个采样都被裁到满高，整条波形成了一个实心方块。
    // 失败形态与成因见 waveform.test.ts 里「存下来的字节要先还原成 0-1 的振幅」。
    expect(source).toContain("normalizePeaks(decodeMeetingPeaks(")
  })

  it("左栏就是一个列表：没有标题、搜索、按钮和提示条", async () => {
    const source = await moduleSource("meeting-list-view.tsx")
    for (const symbol of ["pendingNotice", "onResumePending", "onDiscardPending", "speakerCount", "Search", "Input"]) {
      expect(source).not.toContain(symbol)
    }
  })
})
