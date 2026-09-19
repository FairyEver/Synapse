import { describe, expect, it } from "vitest"

import { MEETING_LIVE_WINDOW_MS, MEETING_PEAK_MS } from "@synapse/shared"

import {
  computeLiveWaveLayout,
  computePlaybackWaveLayout,
  playbackPositionFromClick,
  resamplePlaybackPeaks,
  WAVE_BAR_GAP,
  WAVE_BAR_MAX_WIDTH,
  WAVE_BAR_WIDTH,
} from "../waveform"

const COLUMN = WAVE_BAR_WIDTH + WAVE_BAR_GAP

describe("录音中的波形布局", () => {
  it("一个采样永远占同样宽的槽位，不随采样数量变化", () => {
    // 这条就是「密度固定」本身。按数据长度撑开的实现会让柱子越铺越多、间距越来越小，
    // 录得越久就是把整段越压越扁。
    const few = computeLiveWaveLayout(new Array(20).fill(0.5), 900)
    const many = computeLiveWaveLayout(new Array(170).fill(0.5), 900)
    const spacing = (bars: readonly { x: number }[]) => bars[1].x - bars[0].x
    expect(spacing(few.bars)).toBeCloseTo(COLUMN, 6)
    expect(spacing(many.bars)).toBeCloseTo(COLUMN, 6)

    // 更硬的一条：柱子总数由**时间窗口**封顶，不是由有多少采样决定。录 10 分钟画布上
    // 还是那 5 秒的柱子数，多出来的部分已经从左边滚出去了。
    const windowSlots = Math.round(MEETING_LIVE_WINDOW_MS / MEETING_PEAK_MS)
    const long = computeLiveWaveLayout(new Array(10_000).fill(0.5), 900)
    expect(long.bars).toHaveLength(windowSlots)
    expect(long.bars).toHaveLength(computeLiveWaveLayout(new Array(windowSlots).fill(0.5), 900).bars.length)
  })

  it("贴着右边缘排：装满之前左边的空位空着", () => {
    const layout = computeLiveWaveLayout(new Array(3).fill(0.5), 900)
    const slots = Math.round(MEETING_LIVE_WINDOW_MS / MEETING_PEAK_MS)
    // 只有 3 个采样时，第 4 个槽位就必须是空的——它们靠右，不靠左。
    expect(layout.bars).toHaveLength(3)
    expect(layout.bars[0].x).toBeCloseTo((slots - 3) * COLUMN + COLUMN / 2, 6)
  })

  it("装满 5 秒之后旧的从左边滚出去，只保留最近的一段", () => {
    const peaks = Array.from({ length: 400 }, (_, index) => index / 400)
    const layout = computeLiveWaveLayout(peaks, 900)
    const slots = Math.round(MEETING_LIVE_WINDOW_MS / MEETING_PEAK_MS)
    expect(layout.bars).toHaveLength(slots)
    // 留下的必须是最后 slots 个，也就是最新的那一批。
    expect(layout.bars.at(-1)?.amplitude).toBeCloseTo(399 / 400, 6)
  })

  it("画布窄的时候槽位数由宽度决定，最新的柱子仍贴着右边缘", () => {
    const width = 60
    const layout = computeLiveWaveLayout(new Array(500).fill(0.4), width)
    const widthSlots = Math.floor(width / COLUMN)
    expect(layout.slots).toBe(widthSlots)
    const last = layout.bars.at(-1)!
    expect(last.x + COLUMN / 2).toBeLessThanOrEqual(width + COLUMN)
    expect(last.x).toBeGreaterThan((widthSlots - 1) * COLUMN)
  })

  it("没有采样时不画任何柱子", () => {
    expect(computeLiveWaveLayout([], 900).bars).toEqual([])
  })
})

describe("回放的波形", () => {
  it("整段铺满：重采样之后的柱子数等于画布能画的列数", () => {
    const columns = 100
    expect(resamplePlaybackPeaks(new Array(10_000).fill(0.3), columns)).toHaveLength(columns)
  })

  it("每个桶取最大值而不是平均值", () => {
    // 取平均会把尖峰稀释掉，画出来比实际安静。
    expect(resamplePlaybackPeaks([0.1, 0.9, 0.1, 0.1], 2)).toEqual([0.9, 0.1])
  })

  it("采样数少于列数时原样铺开，不放大也不丢", () => {
    expect(resamplePlaybackPeaks([0.2, 0.4], 100)).toEqual([0.2, 0.4])
  })

  it("空数据返回空", () => {
    expect(resamplePlaybackPeaks([], 100)).toEqual([])
  })
})

describe("回放波形的布局要铺满整条画布", () => {
  const WIDTH = 900
  /**
   * 柱子是不是按时间比例铺满整宽：第 i 根落在第 i 个等分槽的中心。
   *
   * 这正是「视觉和命中区一致」的判据——命中测试按 `offsetX / 宽度` 换算时间，所以柱子
   * 的横坐标必须等于同一个比例。1px 容差留给长录音那档的取整。
   */
  function spansWidth(bars: readonly { x: number }[], width: number): boolean {
    return bars.every((bar, index) => Math.abs(bar.x - ((index + 0.5) / bars.length) * width) <= 1)
  }

  it("采样数少于列数时把槽位拉宽铺满，而不是挤在左边", () => {
    const layout = computePlaybackWaveLayout(new Array(100).fill(0.4), WIDTH)
    expect(layout.bars).toHaveLength(100)
    expect(spansWidth(layout.bars, WIDTH)).toBe(true)
    // 挤在左边的旧实现里最后一根落在 258 附近，这里直接卡死它不能再回来。
    expect(layout.bars.at(-1)!.x).toBeGreaterThan(WIDTH * 0.9)
  })

  it("采样数不够时柱子一根都不合并，槽位只是被拉宽", () => {
    const layout = computePlaybackWaveLayout(new Array(100).fill(0.4), WIDTH)
    expect(layout.bars.map((bar) => bar.amplitude)).toEqual(new Array(100).fill(0.4))
  })

  it("采样数多于列数时仍是固定密度，长录音的观感与改动前一致", () => {
    const layout = computePlaybackWaveLayout(new Array(10_000).fill(0.3), WIDTH)
    expect(layout.bars).toHaveLength(Math.floor(WIDTH / COLUMN))
    expect(layout.bars[1].x - layout.bars[0].x).toBeCloseTo(COLUMN, 6)
    expect(layout.barWidth).toBeCloseTo(WAVE_BAR_WIDTH, 1)
    expect(spansWidth(layout.bars, WIDTH)).toBe(true)
  })

  it("极短的录音柱子会长胖，但有个上限，不会变成一排稀疏的梳齿", () => {
    const layout = computePlaybackWaveLayout(new Array(5).fill(0.5), WIDTH)
    expect(layout.bars).toHaveLength(5)
    expect(layout.barWidth).toBe(WAVE_BAR_MAX_WIDTH)
    expect(spansWidth(layout.bars, WIDTH)).toBe(true)
  })

  it("播放进度按柱子数换算，供已播 / 未播分色", () => {
    const layout = computePlaybackWaveLayout(new Array(100).fill(0.4), WIDTH, { progress: 0.25 })
    expect(layout.splitIndex).toBeCloseTo(25, 6)
  })

  it("没有采样或画布宽度为 0 时不画任何柱子", () => {
    expect(computePlaybackWaveLayout([], WIDTH).bars).toEqual([])
    expect(computePlaybackWaveLayout([0.5], 0).bars).toEqual([])
  })
})

describe("点波形定位", () => {
  it("按横向比例换算成时间", () => {
    expect(playbackPositionFromClick(50, 200, 60_000)).toBe(15_000)
  })

  it("点在两端之外时夹住，不会得到负数或超过总时长", () => {
    expect(playbackPositionFromClick(-20, 200, 60_000)).toBe(0)
    expect(playbackPositionFromClick(999, 200, 60_000)).toBe(60_000)
  })

  it("画布宽度为 0 时返回 0 而不是 NaN", () => {
    expect(playbackPositionFromClick(10, 0, 60_000)).toBe(0)
  })
})
