import { describe, expect, it } from "vitest"

import {
  compactMeetingPeaks,
  decodeMeetingPeaks,
  downsampleMeetingPeaks,
  encodeMeetingPeaks,
  formatMeetingClock,
  formatMeetingDuration,
  meetingPlaybackProgress,
  meetingStatusLabel,
} from "./meeting.js"

describe("formatMeetingDuration", () => {
  it("按分显示，不到一小时不带小时", () => {
    expect(formatMeetingDuration(48 * 60_000)).toBe("48 分")
    expect(formatMeetingDuration(36 * 60_000)).toBe("36 分")
  })

  it("超过一小时同时给小时和分", () => {
    expect(formatMeetingDuration(72 * 60_000)).toBe("1 小时 12 分")
  })

  it("整小时不带零分", () => {
    expect(formatMeetingDuration(2 * 60 * 60_000)).toBe("2 小时")
  })

  it("不到一分钟显示秒而不是 0 分", () => {
    expect(formatMeetingDuration(36_000)).toBe("36 秒")
    expect(formatMeetingDuration(999)).toBe("1 秒")
  })

  it("零和非法值不抛出", () => {
    expect(formatMeetingDuration(0)).toBe("0 秒")
    expect(formatMeetingDuration(Number.NaN)).toBe("0 秒")
  })
})

describe("formatMeetingClock", () => {
  it("一小时以内是 mm:ss", () => {
    expect(formatMeetingClock(42_000)).toBe("00:42")
    expect(formatMeetingClock(9 * 60_000 + 5_000)).toBe("09:05")
  })

  it("一小时以上补上小时段", () => {
    expect(formatMeetingClock(72 * 60_000 + 4_000)).toBe("1:12:04")
  })

  it("负数按 0 处理，不出现 -00:01", () => {
    expect(formatMeetingClock(-1_000)).toBe("00:00")
  })
})

describe("meetingStatusLabel", () => {
  it("三个状态都有中文标签", () => {
    expect(meetingStatusLabel("transcribing")).toBe("转写中")
    expect(meetingStatusLabel("done")).toBe("已完成")
    expect(meetingStatusLabel("failed")).toBe("转写失败")
  })
})

describe("振幅编解码", () => {
  it("往返之后每个采样都还在 8 位精度内", () => {
    const peaks = [0, 0.5, 1, 0.25, 0.75]
    const decoded = decodeMeetingPeaks(encodeMeetingPeaks(peaks))
    expect(decoded.length).toBe(peaks.length)
    for (let index = 0; index < peaks.length; index += 1) {
      expect(Math.abs(decoded[index] / 255 - peaks[index])).toBeLessThan(1 / 255)
    }
  })

  it("空数组编码成空串，解回来还是空", () => {
    expect(encodeMeetingPeaks([])).toBe("")
    expect(decodeMeetingPeaks("").length).toBe(0)
    expect(decodeMeetingPeaks(null).length).toBe(0)
  })

  it("解不开的值按没有波形处理，不抛异常", () => {
    expect(decodeMeetingPeaks("这不是 base64").length).toBe(0)
  })

  it("超出 0-1 的采样被夹住，不会绕回一个小值", () => {
    const decoded = decodeMeetingPeaks(encodeMeetingPeaks([-3, 9]))
    expect(decoded[0]).toBe(0)
    expect(decoded[1]).toBe(255)
  })
})

describe("downsampleMeetingPeaks", () => {
  it("取每个窗口的最大值，不是平均值", () => {
    // 取平均会把一个尖峰稀释掉，画出来比实际安静。
    const peaks = [0.1, 0.9, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2]
    expect(downsampleMeetingPeaks(peaks, 4)).toEqual([0.9, 0.2])
  })

  it("长度按倍数收缩，末尾不足一窗也要保留", () => {
    expect(downsampleMeetingPeaks(new Array(9).fill(0.5), 4).length).toBe(3)
  })

  it("倍数为 1 时返回等长副本", () => {
    expect(downsampleMeetingPeaks([0.1, 0.2, 0.3], 1)).toEqual([0.1, 0.2, 0.3])
  })

  it("接受 Uint8Array，但不会替调用方换数值空间", () => {
    // 这个函数是纯降采样，不管输入是 0-1 还是 0-255。把字节直接喂进来就会原样算出
    // 0-255 的结果——需要换算的是 compactMeetingPeaks，不是它。
    expect(downsampleMeetingPeaks(new Uint8Array([0, 10, 20, 30, 40]), 4)).toEqual([30, 40])
  })

  it("空数组返回空数组", () => {
    expect(downsampleMeetingPeaks([], 4)).toEqual([])
  })
})

describe("compactMeetingPeaks", () => {
  it("解码、降采样、再编码走的是同一套 0-1 数值空间", () => {
    // 直接拿解码出来的字节当浮点用会把整条波形削顶——这里钉住它不会。
    const encoded = encodeMeetingPeaks([0, 0.2, 1, 0.4, 0.6, 0.6, 0.6, 0.6])
    const compacted = compactMeetingPeaks(encoded)
    const decoded = decodeMeetingPeaks(compacted)
    expect(decoded.length).toBe(2)
    expect(decoded[0]).toBe(255)
    expect(decoded[1]).toBe(Math.round(0.6 * 255))
  })

  it("空值和不合法输入返回 null，调用方据此存空", () => {
    expect(compactMeetingPeaks("")).toBeNull()
    expect(compactMeetingPeaks(null)).toBeNull()
    expect(compactMeetingPeaks("这不是 base64")).toBeNull()
  })
})

describe("meetingPlaybackProgress", () => {
  it("按位置给出 0-1 的比例", () => {
    expect(meetingPlaybackProgress(30_000, 60_000)).toBe(0.5)
  })

  it("超出两端一律夹住，播放头不会跑到波形外面", () => {
    expect(meetingPlaybackProgress(-1, 60_000)).toBe(0)
    expect(meetingPlaybackProgress(90_000, 60_000)).toBe(1)
  })

  it("总时长为 0 时给 0 而不是 NaN", () => {
    expect(meetingPlaybackProgress(1_000, 0)).toBe(0)
  })
})
