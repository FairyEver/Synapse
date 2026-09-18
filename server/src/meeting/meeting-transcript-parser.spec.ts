import { describe, expect, it } from "vitest"

import { parseTencentTranscript } from "./meeting-transcript-parser"

/**
 * `ResTextFormat=1` 的真实返回形状。
 *
 * 结构不是推测出来的：结构化结果在 `ResultDetail` 里（不在 `Result` 里），词级时间戳
 * 在 `ResultDetail[].Words[]`，而且词的偏移是**相对本句**的。只读 `Result` 会得到一堆
 * 没有时间戳、没有说话人的连续文字。
 */
const RESULT_DETAIL_FIXTURE = JSON.stringify({
  Result: "今天主要过三件事。导出我先说。",
  ResultDetail: [
    {
      FinalSentence: "今天主要过三件事。",
      SliceSentence: "今天 主要 过 三件事",
      StartMs: 0,
      EndMs: 3000,
      SpeakerId: 0,
      WordsNum: 4,
      Words: [
        { Word: "今天", OffsetStartMs: 0, OffsetEndMs: 400 },
        { Word: "主要", OffsetStartMs: 400, OffsetEndMs: 800 },
        { Word: "过", OffsetStartMs: 800, OffsetEndMs: 1000 },
        { Word: "三件事。", OffsetStartMs: 1000, OffsetEndMs: 3000 },
      ],
    },
    {
      FinalSentence: "导出我先说。",
      StartMs: 15_000,
      EndMs: 18_200,
      SpeakerId: 1,
      Words: [{ Word: "导出", OffsetStartMs: 0, OffsetEndMs: 600 }],
    },
  ],
})

describe("parseTencentTranscript", () => {
  it("从 ResultDetail 取段落，带说话人与起止时间", () => {
    const parsed = parseTencentTranscript(RESULT_DETAIL_FIXTURE)
    expect(parsed.segments).toHaveLength(2)
    expect(parsed.segments[0]).toMatchObject({ speakerId: 0, startMs: 0, endMs: 3000, text: "今天主要过三件事。" })
    expect(parsed.segments[1]).toMatchObject({ speakerId: 1, startMs: 15_000, endMs: 18_200, text: "导出我先说。" })
    expect(parsed.speakerCount).toBe(2)
  })

  it("词的偏移是相对本句的，落库前换成绝对时间", () => {
    // 不换算的话第二句的「导出」会落在 0 秒上，整篇字幕都堆在开头。
    const parsed = parseTencentTranscript(RESULT_DETAIL_FIXTURE)
    expect(parsed.segments[0].words[0]).toEqual({ text: "今天", startMs: 0, endMs: 400 })
    expect(parsed.segments[1].words[0]).toEqual({ text: "导出", startMs: 15_000, endMs: 15_600 })
  })

  it("只有 Result 没有 ResultDetail 时退回纯文本行解析", () => {
    const parsed = parseTencentTranscript(
      JSON.stringify({
        Result: "[0:0.420,0:1.120,0]  啊。\n[0:1.420,0:15.460,2]  喂，你好。",
      }),
    )
    expect(parsed.segments).toHaveLength(2)
    expect(parsed.segments[0]).toMatchObject({ speakerId: 0, startMs: 420, endMs: 1120, text: "啊。" })
    expect(parsed.segments[1]).toMatchObject({ speakerId: 2, startMs: 1420, endMs: 15_460, text: "喂，你好。" })
    expect(parsed.speakerCount).toBe(2)
  })

  it("段落按时间排序，即使返回顺序是乱的", () => {
    const parsed = parseTencentTranscript(
      JSON.stringify({
        ResultDetail: [
          { FinalSentence: "后说的", StartMs: 9_000, EndMs: 10_000, SpeakerId: 0 },
          { FinalSentence: "先说的", StartMs: 1_000, EndMs: 2_000, SpeakerId: 1 },
        ],
      }),
    )
    expect(parsed.segments.map((segment) => segment.text)).toEqual(["先说的", "后说的"])
  })

  it("静音录音是合法结果：没有段落，也不抛异常", () => {
    expect(parseTencentTranscript(null)).toEqual({ segments: [], speakerCount: 0 })
    expect(parseTencentTranscript("")).toEqual({ segments: [], speakerCount: 0 })
    expect(parseTencentTranscript(JSON.stringify({ ResultDetail: [] }))).toEqual({ segments: [], speakerCount: 0 })
  })

  it("解析不了的内容当作没有识别到语音，而不是抛出去让整条任务失败", () => {
    expect(parseTencentTranscript("这是一段不是 JSON 的文字")).toEqual({ segments: [], speakerCount: 0 })
    expect(parseTencentTranscript("{}")).toEqual({ segments: [], speakerCount: 0 })
  })

  it("丢掉空句子，不让空段落占一个位置", () => {
    const parsed = parseTencentTranscript(
      JSON.stringify({
        ResultDetail: [
          { FinalSentence: "   ", StartMs: 0, EndMs: 100, SpeakerId: 0 },
          { FinalSentence: "有内容", StartMs: 1_000, EndMs: 2_000, SpeakerId: 0 },
        ],
      }),
    )
    expect(parsed.segments.map((segment) => segment.text)).toEqual(["有内容"])
  })

  it("重复词不会因为偏移相同被丢掉", () => {
    const parsed = parseTencentTranscript(
      JSON.stringify({
        ResultDetail: [
          {
            FinalSentence: "对对对",
            StartMs: 500,
            EndMs: 900,
            SpeakerId: 0,
            Words: [
              { Word: "对", OffsetStartMs: 0, OffsetEndMs: 100 },
              { Word: "对", OffsetStartMs: 100, OffsetEndMs: 200 },
              { Word: "对", OffsetStartMs: 200, OffsetEndMs: 400 },
            ],
          },
        ],
      }),
    )
    expect(parsed.segments[0].words).toHaveLength(3)
    expect(parsed.segments[0].words.map((word) => word.startMs)).toEqual([500, 600, 700])
  })
})
