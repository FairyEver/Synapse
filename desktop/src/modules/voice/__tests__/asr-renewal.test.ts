import { describe, expect, it } from "vitest"

import {
  FORCE_AFTER_MS,
  PLAN_AFTER_MS,
  SILENCE_RMS,
  chunkRms,
  mergeTranscript,
  promoteSeam,
  shouldHandOver,
  shouldStartWarming,
  type AsrSeam,
} from "../asr-renewal"

/** 一包 16k / 16bit / 单声道的小端采样，和真正送出去的那份字节布局完全一样。 */
function pcm(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((value, index) => { view.setInt16(index * 2, value, true) })
  return bytes
}

function transcript(stable: string, unstable: string) {
  return { stable, unstable, combined: `${stable}${unstable}` }
}

describe("轮换时机", () => {
  it("还没到计划点就不预热", () => {
    expect(shouldStartWarming(PLAN_AFTER_MS - 1)).toBe(false)
    expect(shouldStartWarming(PLAN_AFTER_MS)).toBe(true)
  })

  it("暖连接还没就绪之前不会接棒", () => {
    expect(shouldHandOver(0, PLAN_AFTER_MS - 1)).toBe(false)
  })

  it("到了计划点、又赶上停顿，就在停顿处接棒", () => {
    expect(shouldHandOver(SILENCE_RMS / 2, PLAN_AFTER_MS)).toBe(true)
  })

  it("一直在说话就等硬顶，不从中途切", () => {
    expect(shouldHandOver(1, FORCE_AFTER_MS - 1)).toBe(false)
    expect(shouldHandOver(1, FORCE_AFTER_MS)).toBe(true)
  })

  it("两个阈值怎么取都只会落在计划点和硬顶之间，绝不越过引擎的 60 秒", () => {
    // 这条性质是设计出来的：门控取错最坏退化成「永远走硬顶」，不会越界。
    for (const rms of [0, 0.001, SILENCE_RMS, 0.02, 0.12, 1]) {
      const first = [PLAN_AFTER_MS, PLAN_AFTER_MS + 1, FORCE_AFTER_MS - 1, FORCE_AFTER_MS]
        .find((ageMs) => shouldHandOver(rms, ageMs))
      expect(first).toBeDefined()
      expect(first).toBeGreaterThanOrEqual(PLAN_AFTER_MS)
      expect(first).toBeLessThanOrEqual(FORCE_AFTER_MS)
    }
  })
})

describe("接缝定稿", () => {
  it("定稿是换掉暂定的那份，不是接在它后面", () => {
    const provisional: AsrSeam = { text: "还有一件事是键盘面板", provisional: true }
    const settled = promoteSeam(provisional, "还有一件事是键盘面板，现在的面板分成两页")
    expect(settled.provisional).toBe(false)
    expect(settled.text).toBe("还有一件事是键盘面板，现在的面板分成两页")
  })
})

describe("接缝拼接", () => {
  it("没有接缝时一字不动", () => {
    const live = transcript("第一句。", "第二句")
    expect(mergeTranscript(null, live)).toEqual(live)
  })

  it("接缝已定稿、活连接还没定稿", () => {
    const merged = mergeTranscript({ text: "前半段。", provisional: false }, transcript("", "正在说"))
    expect(merged.stable).toBe("前半段。")
    expect(merged.unstable).toBe("正在说")
    expect(merged.combined).toBe("前半段。正在说")
  })

  it("两边都定稿时按接缝在前拼接", () => {
    const merged = mergeTranscript({ text: "前半段。", provisional: false }, transcript("后半段。", ""))
    expect(merged.stable).toBe("前半段。后半段。")
    expect(merged.combined).toBe("前半段。后半段。")
  })

  it("接缝还没定稿时，活连接定稿的句子也得排在它后面", () => {
    // 顺序比颜色重要：颜色错了只是看着别扭，顺序错了是用户提交的文字前后颠倒。
    const merged = mergeTranscript({ text: "前半段", provisional: true }, transcript("后半段。", "正在说"))
    expect(merged.stable).toBe("")
    expect(merged.unstable).toBe("前半段后半段。正在说")
    expect(merged.combined).toBe("前半段后半段。正在说")
  })

  it("接缝是空串时和没有接缝的结果一致", () => {
    const live = transcript("全部", "")
    expect(mergeTranscript({ text: "", provisional: false }, live)).toEqual(live)
  })

  it("四种组合下 combined 都保持接缝在前", () => {
    const seams: AsrSeam[] = [
      { text: "甲", provisional: false },
      { text: "甲", provisional: true },
      { text: "", provisional: false },
      { text: "", provisional: true },
    ]
    for (const seam of seams) {
      for (const live of [transcript("乙", ""), transcript("", "丙"), transcript("乙", "丙")]) {
        expect(mergeTranscript(seam, live).combined).toBe(`${seam.text}${live.combined}`)
      }
    }
  })
})

describe("响度", () => {
  it("静音和说话分得开", () => {
    expect(chunkRms(pcm(0, 0, 0, 0))).toBe(0)
    expect(chunkRms(pcm(8192, 8192, 8192, 8192))).toBeCloseTo(0.25, 3)
    expect(chunkRms(pcm(1638, 1638, 1638, 1638))).toBeCloseTo(0.05, 3)
  })

  it("正好落在门上的那一包算「还在说话」", () => {
    // 边界归哪边要钉死：噪声底稍高时不能因为踩线就当成用户停下来了。
    const onTheGate = Math.round(SILENCE_RMS * 32_768)
    expect(chunkRms(pcm(onTheGate, onTheGate))).toBeCloseTo(SILENCE_RMS, 4)
    expect(shouldHandOver(chunkRms(pcm(onTheGate, onTheGate)), PLAN_AFTER_MS)).toBe(false)
  })

  it("负半周不会被当成静音", () => {
    // 采样是有符号的：用无符号读会把 -8192 读成 57344，静音的判定整个反掉。
    expect(chunkRms(pcm(-8192, -8192, -8192, -8192))).toBeCloseTo(0.25, 3)
  })
})
