// @vitest-environment jsdom
import { expect, it } from "vitest"
import { sanitizeComposeDocument } from "../compose-document"
it("keeps basic pasted styles and only currently owned CID images", () => {
  const result = sanitizeComposeDocument('<script>alert(1)</script><p><strong>Bold</strong><span style="font-size:18px;position:fixed;background:url(http://tracker)">Text</span></p><img src="https://tracker"><img src="file:///secret"><img src="cid:owned"><a href="javascript:alert(1)">Link</a>', [{ assetId: "mas_owned", cid: "owned" }])
  expect(result.html).toContain("<strong>Bold</strong>"); expect(result.html).toContain("font-size: 18px")
  expect(result.html).toContain('data-asset-id="mas_owned"')
  expect(result.html).not.toMatch(/script|https:|file:|javascript:|position|background/iu)
  expect(result.text).toContain("BoldText")
})
