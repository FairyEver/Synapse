// @vitest-environment jsdom
import { expect, it } from "vitest"
import { sanitizeMailHtml } from "../sanitize-body"
it("removes active HTML, styles and all ungranted image sources, retaining only scoped blob resources", () => {
  const result = sanitizeMailHtml(`<script>alert(1)</script><svg onload="alert(1)"></svg><style>p{background:url(http://private)}</style><p style="background:url(file:///x)" onclick="alert(1)">正文</p><img src="https://tracker.invalid/x"><img src="cid:ok"><img src="file:///secret"><a href="javascript:alert(1)">bad</a><a href="https://example.com/path">open</a><iframe src="http://private"></iframe>`, { cid: { ok: "blob:https://synapse.invalid/scoped" }, remote: {} })
  expect(result.html).not.toMatch(/<script|<svg|<style|onclick|file:|javascript:|tracker\.invalid|<iframe src/iu)
  expect(result.html).toContain("blob:https://synapse.invalid/scoped")
  expect(result.html).toContain("default-src 'none'")
  expect(result.blockedImages).toBe(2); expect(result.links).toEqual([{ label: "open", url: "https://example.com/path" }])
})
