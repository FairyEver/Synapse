import { describe, expect, it } from "vitest"

import { AsrTranscriptAccumulator } from "../asr-transcript"

describe("AsrTranscriptAccumulator", () => {
  it("未定稿的文字不算进已定稿", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 1, index: 0, text: "帮我看看" })
    const snapshot = accumulator.snapshot()
    expect(snapshot.unstable).toBe("帮我看看")
    expect(snapshot.stable).toBe("")
  })

  it("定稿后同一句从当前句移到已定稿", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 1, index: 0, text: "帮我看看终端" })
    accumulator.apply({ sliceType: 2, index: 0, text: "帮我看看终端。" })
    const snapshot = accumulator.snapshot()
    expect(snapshot.stable).toBe("帮我看看终端。")
    expect(snapshot.unstable).toBe("")
  })

  it("未定稿结果反复下发时以最后一次为准", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 1, index: 0, text: "跑一下" })
    accumulator.apply({ sliceType: 1, index: 0, text: "跑一下 pnpm" })
    expect(accumulator.snapshot().unstable).toBe("跑一下 pnpm")
  })

  it("多句按 index 顺序拼接，与到达顺序无关", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 2, index: 1, text: "第二句。" })
    accumulator.apply({ sliceType: 2, index: 0, text: "第一句。" })
    expect(accumulator.snapshot().stable).toBe("第一句。第二句。")
  })

  it("当前句排在所有已定稿之后", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 2, index: 0, text: "第一句。" })
    accumulator.apply({ sliceType: 1, index: 1, text: "第二句还没定" })
    const snapshot = accumulator.snapshot()
    expect(snapshot.combined).toBe("第一句。第二句还没定")
    expect(snapshot.unstable).toBe("第二句还没定")
  })

  it("只有 0-2 序列也能拿到完整文本", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 0, index: 0, text: "" })
    accumulator.apply({ sliceType: 2, index: 0, text: "git status" })
    expect(accumulator.finalText()).toBe("git status")
  })

  /**
   * slice_type=0 是「这句话开始」，它带的文字还会变。当成定稿的话，紧接着的
   * slice_type=1 会让同一句同时出现在两级里，拼出重复文本。
   */
  it("句子开始不算定稿，不会和后面的识别中重复", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 0, index: 0, text: "帮我看看" })
    expect(accumulator.snapshot().stable).toBe("")
    expect(accumulator.snapshot().unstable).toBe("帮我看看")

    accumulator.apply({ sliceType: 1, index: 0, text: "帮我看看终端" })
    const snapshot = accumulator.snapshot()
    expect(snapshot.stable).toBe("")
    expect(snapshot.combined).toBe("帮我看看终端")

    accumulator.apply({ sliceType: 2, index: 0, text: "帮我看看终端。" })
    expect(accumulator.finalText()).toBe("帮我看看终端。")
  })

  it("迟到的识别中不能把已定稿的句子重新打开", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 2, index: 0, text: "第一句。" })
    expect(accumulator.apply({ sliceType: 1, index: 0, text: "第一句" })).toBe(false)
    expect(accumulator.snapshot().stable).toBe("第一句。")
    expect(accumulator.snapshot().unstable).toBe("")
  })

  it("什么都不说时 finalText 是空串", () => {
    const accumulator = new AsrTranscriptAccumulator()
    expect(accumulator.finalText()).toBe("")
    expect(accumulator.isEmpty).toBe(true)
  })

  it("只有空白也不当成有内容", () => {
    const accumulator = new AsrTranscriptAccumulator()
    accumulator.apply({ sliceType: 1, index: 0, text: "   " })
    expect(accumulator.finalText()).toBe("")
  })

  it("重复下发完全相同的结果不报告变化", () => {
    const accumulator = new AsrTranscriptAccumulator()
    expect(accumulator.apply({ sliceType: 1, index: 0, text: "abc" })).toBe(true)
    expect(accumulator.apply({ sliceType: 1, index: 0, text: "abc" })).toBe(false)
    expect(accumulator.apply({ sliceType: 1, index: 0, text: "abcd" })).toBe(true)
  })
})
