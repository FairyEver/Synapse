import { describe, expect, it } from "vitest"
import { isDriveSiteHtmlPath, normalizeDriveSiteRelativePath, resolveDriveSiteRequestPath } from "./drive-site-path"

describe("Drive site path helpers", () => {
  it("normalizes safe slash-delimited paths", () => {
    expect(normalizeDriveSiteRelativePath("docs/index.html")).toBe("docs/index.html")
    expect(normalizeDriveSiteRelativePath("docs//guide.html")).toBe("docs/guide.html")
  })

  it("rejects unsafe paths", () => {
    for (const value of ["", "/index.html", "../secret.txt", "a/../b.html", "a\\b.html"]) {
      expect(() => normalizeDriveSiteRelativePath(value)).toThrow("站点路径无效。")
    }
  })

  it("resolves root and nested directory requests", () => {
    expect(resolveDriveSiteRequestPath("")).toEqual({ kind: "entry" })
    expect(resolveDriveSiteRequestPath("docs/")).toEqual({ kind: "asset", relativePath: "docs/index.html", directory: true })
    expect(resolveDriveSiteRequestPath("docs")).toEqual({ kind: "asset", relativePath: "docs", directory: false })
  })

  it("detects html paths", () => {
    expect(isDriveSiteHtmlPath("index.html")).toBe(true)
    expect(isDriveSiteHtmlPath("INDEX.HTM")).toBe(true)
    expect(isDriveSiteHtmlPath("assets/app.js")).toBe(false)
  })
})
