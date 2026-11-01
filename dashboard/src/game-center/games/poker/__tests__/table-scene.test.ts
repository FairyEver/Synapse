import { describe, expect, it } from "vitest"
import { fitTableScene } from "../lib/table-scene"
import { seatPosition } from "../lib/view"

describe("按可用区域适配牌桌", () => {
  it.each([
    [1300, 740, "landscape"], [760, 760, "square"], [470, 810, "portrait"],
  ] as const)("%s × %s 使用 %s 并完整等比例呈现", (width, height, mode) => {
    const fit = fitTableScene(width, height)
    expect(fit.scene.mode).toBe(mode)
    expect(fit.width).toBeLessThanOrEqual(width)
    expect(fit.height).toBeLessThanOrEqual(height)
    expect(fit.width / fit.height).toBeCloseTo(fit.scene.width / fit.scene.height)
    expect(fit.width / fit.scene.width).toBeCloseTo(fit.height / fit.scene.height)
  })

  it("零高、隐藏和非有限尺寸不会产生 NaN 或无限缩放", () => {
    for (const [width, height] of [[0, 0], [600, 0], [-10, 700], [Infinity, 700], [700, NaN]]) {
      const fit = fitTableScene(width, height)
      expect(fit.scale).toBe(0)
      expect(fit.width).toBe(0)
      expect(fit.height).toBe(0)
    }
  })

  it("临界比例选择占用可用面积更大的场景，避免过早换桌产生留白", () => {
    expect(fitTableScene(980, 700).scene.mode).toBe("landscape")
    expect(fitTableScene(840, 1000).scene.mode).toBe("square")
    expect(fitTableScene(600, 1000).scene.mode).toBe("portrait")
  })

  it.each([[1440, 900], [1080, 1080], [840, 1320]])("%sx%s 内所有容量的选手、中心与下注留有空间", (width, height) => {
    const { scene } = fitTableScene(width, height)
    const overlaps = (a: {x:number;y:number;width:number;height:number}, b: typeof a) =>
      Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2
    for (let count = 2; count <= 10; count++) {
      const seats = Array.from({length:count}, (_, i) => ({...scene.seats[seatPosition(i, count)], width:230, height:i === 0 ? 260 : 240}))
      const board = {...scene.center, width:scene.boardCardWidth * 5 + 32, height:300}
      for (let i = 0; i < seats.length; i++) {
        const seat = seats[i]
        expect(seat.x - seat.width / 2).toBeGreaterThanOrEqual(0)
        expect(seat.x + seat.width / 2).toBeLessThanOrEqual(scene.width)
        expect(seat.y - seat.height / 2).toBeGreaterThanOrEqual(0)
        expect(seat.y + seat.height / 2).toBeLessThanOrEqual(scene.height)
        expect(overlaps(seat, board), `容量 ${count} 座位 ${i} 遮挡公共牌`).toBe(false)
        for (let j = i + 1; j < seats.length; j++) expect(overlaps(seat, seats[j]), `容量 ${count} 座位 ${i}/${j} 重叠`).toBe(false)

      }
    }
  })
})
