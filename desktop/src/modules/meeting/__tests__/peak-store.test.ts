import { describe, expect, it } from "vitest"

import { decodeMeetingPeaks } from "@synapse/shared"

import {
  AMPLITUDE_DECAY,
  AMPLITUDE_FLOOR,
  amplitudeFromTimeDomain,
  createPeakScheduler,
  createPeakStore,
  smoothAmplitude,
} from "../peak-store"

describe("振幅计算", () => {
  it("用 RMS 而不是峰值", () => {
    // 一个尖峰加一长串零：峰值会顶满，RMS 才是「这一段有多响」。
    const samples = new Float32Array(1000)
    samples[0] = 1
    const rms = amplitudeFromTimeDomain(samples)
    expect(rms).toBeGreaterThan(0)
    expect(rms).toBeLessThan(0.3)
  })

  it("整段满幅的信号会被顶到 1 附近", () => {
    expect(amplitudeFromTimeDomain(new Float32Array(64).fill(0.5))).toBeGreaterThan(1)
  })

  it("静音给 0", () => {
    expect(amplitudeFromTimeDomain(new Float32Array(64))).toBe(0)
  })

  it("空输入不抛异常", () => {
    expect(amplitudeFromTimeDomain(new Float32Array(0))).toBe(0)
  })
})

describe("包络平滑", () => {
  it("上升立刻跟上", () => {
    expect(smoothAmplitude(0.1, 0.8)).toBeCloseTo(0.8, 6)
  })

  it("下降缓慢回落，不会一根刺跳回底", () => {
    // 一下跳到 0 会让波形看起来像断断续续的噪声。
    expect(smoothAmplitude(0.8, 0)).toBeCloseTo(0.8 * AMPLITUDE_DECAY, 6)
  })

  it("静音也有一个极小的底，柱子不会缩成看不见的线", () => {
    expect(smoothAmplitude(0, 0)).toBe(AMPLITUDE_FLOOR)
  })

  it("超过 1 的部分夹住", () => {
    expect(smoothAmplitude(0, 5)).toBe(1)
  })
})

describe("采样存储", () => {
  it("push 返回平滑之后的振幅并按顺序累积", () => {
    const store = createPeakStore()
    store.push(0.5)
    store.push(0.5)
    expect(store.length).toBe(2)
    expect(store.snapshot()[1]).toBeCloseTo(0.5, 6)
  })

  it("编码出来的东西能被解回同样多的采样", () => {
    const store = createPeakStore()
    for (const value of [0.1, 0.4, 0.9]) store.push(value)
    const decoded = decodeMeetingPeaks(store.encode())
    expect(decoded.length).toBe(3)
    expect(decoded[2] / 255).toBeCloseTo(0.9, 2)
  })

  it("reset 之后重新开始，不会把上一段的波形带过来", () => {
    const store = createPeakStore()
    store.push(0.9)
    store.reset()
    expect(store.length).toBe(0)
    expect(store.encode()).toBe("")
  })
})

describe("采样节拍", () => {
  it("按时间间隔到点才采，不按回调次数", () => {
    // 数回调次数的话，主线程一卡整条波形就被拉长。
    const scheduler = createPeakScheduler(28)
    scheduler.reset(1000)
    expect(scheduler.due(1010)).toBe(false)
    expect(scheduler.due(1028)).toBe(true)
    expect(scheduler.due(1030)).toBe(false)
    expect(scheduler.due(1056)).toBe(true)
  })

  it("一次卡顿之后不会补采一堆，只按当前时刻推进", () => {
    const scheduler = createPeakScheduler(28)
    scheduler.reset(0)
    expect(scheduler.due(5000)).toBe(true)
    expect(scheduler.due(5010)).toBe(false)
  })
})
