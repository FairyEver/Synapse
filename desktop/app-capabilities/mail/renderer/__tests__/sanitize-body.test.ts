// @vitest-environment jsdom
import { expect, it, vi } from "vitest"
import { sanitizeMailHtml } from "../sanitize-body"
it("removes active HTML, styles and all ungranted image sources, retaining only scoped blob resources", () => {
  const result = sanitizeMailHtml(`<script>alert(1)</script><svg onload="alert(1)"></svg><style>p{background:url(http://private)}</style><p style="background:url(file:///x)" onclick="alert(1)">正文</p><img src="https://tracker.invalid/x"><img src="cid:ok"><img src="file:///secret"><a href="javascript:alert(1)">bad</a><a href="https://example.com/path">open</a><iframe src="http://private"></iframe>`, { cid: { ok: "blob:https://synapse.invalid/scoped" }, remote: {} })
  expect(result.html).not.toMatch(/<script|<svg|onclick|file:|javascript:|tracker\.invalid|<iframe src/iu)
  expect(result.html).toContain("blob:https://synapse.invalid/scoped")
  expect(result.html).toContain("default-src 'none'")
  expect(result.blockedImages).toBe(2); expect(result.links).toEqual([{ label: "open", url: "https://example.com/path" }])
})
it("treats prototype names as ungranted external image identifiers", () => {
  const result = sanitizeMailHtml('<img src="cid:__proto__"><img src="constructor">', { cid: {}, remote: {} })
  expect(result.blockedImages).toBe(2)
})
it("does not pass armed remote images or frames to a document parser", () => {
  const inputs: string[] = [], original = DOMParser.prototype.parseFromString
  const spy = vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, ...args: Parameters<DOMParser["parseFromString"]>) { inputs.push(String(args[0])); return original.apply(this, args) })
  try {
    const safe = sanitizeMailHtml('<p>body</p><img src="https://tracker.invalid/pixel"><iframe src="https://tracker.invalid/frame"></iframe>', { cid: {}, remote: {} })
    expect(inputs.some(input => input.includes("tracker.invalid"))).toBe(false)
    expect(safe.html).not.toContain('src="https://tracker.invalid')
  } finally { spy.mockRestore() }
})

it("provides only trusted typography while rejecting sender styles", () => {
  const result = sanitizeMailHtml('<style>body{display:none}</style><p style="font-size:100px">Text</p>', { cid: {}, remote: {} })
  expect(result.html).toContain("font-family:system-ui")
  expect(result.html).toContain("overflow-wrap:anywhere")
  expect(result.html).not.toContain("display:none")
  expect(result.html).not.toContain("100px")
  expect(result.html.match(/<style/g)).toHaveLength(1)
})
