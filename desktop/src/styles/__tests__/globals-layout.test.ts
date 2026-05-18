import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const globalsCss = readFileSync(
  resolve(__dirname, "../globals.css"),
  "utf8",
)

describe("global app layout styles", () => {
  it("locks document scrolling to app-owned scroll containers", () => {
    expect(globalsCss).toContain("html,")
    expect(globalsCss).toContain("body,")
    expect(globalsCss).toContain("#root {")
    expect(globalsCss).toContain("height: 100%;")
    expect(globalsCss).toContain("overflow: hidden;")
    expect(globalsCss).toContain("overscroll-behavior: none;")
  })
})
