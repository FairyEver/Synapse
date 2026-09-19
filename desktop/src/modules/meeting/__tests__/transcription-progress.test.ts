import { describe, expect, it } from "vitest"

import type { MeetingTranscriptionProgressDto } from "@synapse/shared"

import {
  transcriptionElapsedMs,
  transcriptionProgressPercent,
  transcriptionStageLabel,
} from "../transcription-progress"

function progress(overrides: Partial<MeetingTranscriptionProgressDto> = {}): MeetingTranscriptionProgressDto {
  return { stage: "running", elapsedMs: 0, expectedMs: 80_000, ...overrides }
}

describe("进度条画到哪儿", () => {
  it("按已用时长比估算出来的总时长", () => {
    expect(transcriptionProgressPercent(20_000, 80_000)).toBe(25)
    expect(transcriptionProgressPercent(40_000, 80_000)).toBe(50)
  })

  /**
   * 估算不是承诺。超了还接着画的话，条会停在 100% 而结果迟迟不来——那比停在 95% 更让人
   * 以为出了故障，而这正是这次要修的那个「看不出在动还是死了」。
   */
  it("超过估算时间也封顶在 95%，不画满", () => {
    expect(transcriptionProgressPercent(80_000, 80_000)).toBe(95)
    expect(transcriptionProgressPercent(30 * 60_000, 80_000)).toBe(95)
  })

  it("估算是零或负数时不画，不去除零", () => {
    expect(transcriptionProgressPercent(10_000, 0)).toBe(0)
    expect(transcriptionProgressPercent(10_000, -1)).toBe(0)
    expect(transcriptionProgressPercent(Number.NaN, 80_000)).toBe(0)
  })

  it("还没开始用时是零", () => {
    expect(transcriptionProgressPercent(0, 80_000)).toBe(0)
  })
})

describe("秒表", () => {
  /**
   * 服务端给的数只到「它生成响应的那一刻」，而两端是每几秒才刷一次。刷新间隔里客户端
   * 接着往下走，否则条会每五秒跳一格、中间四秒纹丝不动。
   */
  it("在两次刷新之间接着服务端给的已用时长往下走", () => {
    expect(transcriptionElapsedMs(progress({ elapsedMs: 5_000 }), 1_000, 4_000)).toBe(8_000)
  })

  it("拿不到进度时是零", () => {
    expect(transcriptionElapsedMs(undefined, 1_000, 4_000)).toBe(0)
  })

  /** 用的是本机两次读取之间的差值，不是「本机挂钟减服务端时间戳」——设备时钟不准也算得对。 */
  it("本机时钟往回跳时不会倒退成负数", () => {
    expect(transcriptionElapsedMs(progress({ elapsedMs: 5_000 }), 10_000, 9_000)).toBe(5_000)
  })
})

describe("阶段文案", () => {
  it("投出去了说识别中，还没投出去说排队中", () => {
    expect(transcriptionStageLabel(progress({ stage: "running" }))).toBe("识别中")
    expect(transcriptionStageLabel(progress({ stage: "queued" }))).toBe("排队中")
  })
})
