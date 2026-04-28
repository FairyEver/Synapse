import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("TableSchemaSheet table description editor", () => {
  it("exposes a compact table description editor before the columns table", async () => {
    const source = await readFile(
      new URL("../components/table-schema-sheet.tsx", import.meta.url),
      "utf8",
    )

    const descriptionIndex = source.indexOf("表备注")
    const tableIndex = source.indexOf("<Table>")

    expect(source).toContain("onUpdateTableDescription")
    expect(source).toContain("id=\"table-description\"")
    expect(source).toContain("commitTableDescription")
    expect(descriptionIndex).toBeGreaterThan(-1)
    expect(tableIndex).toBeGreaterThan(-1)
    expect(descriptionIndex).toBeLessThan(tableIndex)
  })
})
