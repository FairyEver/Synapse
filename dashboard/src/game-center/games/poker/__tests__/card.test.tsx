/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { Card } from "../components/Card"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("共用矢量纸牌", () => {
  it("52 张牌均有独立的本地矢量牌面，10 点保持协议编码 T", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    const cards = [..."shdc"].flatMap((suit) => [..."23456789TJQKA"].map((rank) => rank + suit))
    await act(async () =>
      root.render(
        <>
          {cards.map((card) => (
            <Card key={card} card={card} />
          ))}
        </>,
      ),
    )
    const faces = [...host.querySelectorAll<HTMLImageElement>(".poker-card-front img")]
    expect(faces).toHaveLength(52)
    expect(new Set(faces.map((face) => face.src)).size).toBe(52)
    expect(
      faces.every(
        (face) => face.getAttribute("src") && !/^https?:/.test(face.getAttribute("src")!),
      ),
    ).toBe(true)
    expect(host.querySelector('[data-card="Th"]')?.getAttribute("aria-label")).toBe("10♥")
    await act(async () => root.unmount())
  })
  it("遮蔽的已知牌只提供牌背，DOM 不含牌值、牌面图片或牌值描述", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () => root.render(<Card card="Kh" faceUp={false} />))
    expect(host.querySelector('[data-face="down"]')?.getAttribute("aria-label")).toBe("牌背")
    expect(host.querySelector("[data-card]")).toBeNull()
    expect(host.querySelector(".poker-card-front img")).toBeNull()
    expect(host.textContent).not.toContain("K")
    expect(host.textContent).not.toContain("♥")
    await act(async () => root.unmount())
  })
  it("未发牌和无效牌值保留空槽，不显示破损图片", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () =>
      root.render(
        <>
          <Card />
          <Card card="invalid" />
        </>,
      ),
    )
    expect(host.querySelectorAll('[aria-label="未发牌"]')).toHaveLength(2)
    expect(host.querySelector("img")).toBeNull()
    await act(async () => root.unmount())
  })
})
