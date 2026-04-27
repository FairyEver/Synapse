import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("scan item detail dialog layout", () => {
  it("keeps the preview/source switch outside the dialog header", async () => {
    const source = await readFile(
      new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
      "utf8",
    )
    const headerStart = source.indexOf("<DialogHeader")
    const headerEnd = source.indexOf("</DialogHeader>", headerStart)
    const headerContent = source.slice(headerStart, headerEnd)

    expect(headerContent).not.toContain("<Tabs")
  })
})
