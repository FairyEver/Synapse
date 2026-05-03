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

  it("guards Escape cancel from the blur commit path", async () => {
    const source = await readFile(
      new URL("../components/table-schema-sheet.tsx", import.meta.url),
      "utf8",
    )

    const commitIndex = source.indexOf("const commitTableDescription")
    const commitGuardIndex = source.indexOf("if (skipTableDescriptionCommitRef.current)", commitIndex)
    const commitGuardResetIndex = source.indexOf("skipTableDescriptionCommitRef.current = false", commitGuardIndex)
    const commitGuardReturnIndex = source.indexOf("return", commitGuardResetIndex)
    const saveIndex = source.indexOf("await onUpdateTableDescription", commitIndex)
    const escapeIndex = source.indexOf('event.key === "Escape"')
    const escapeGuardIndex = source.indexOf("skipTableDescriptionCommitRef.current = true", escapeIndex)
    const escapeBlurIndex = source.indexOf("event.currentTarget.blur()", escapeGuardIndex)
    const dialogEscapeIndex = source.indexOf("onEscapeKeyDown")
    const activeDescriptionIndex = source.indexOf('document.activeElement?.id === "table-description"', dialogEscapeIndex)
    const dialogEscapePreventIndex = source.indexOf("event.preventDefault()", activeDescriptionIndex)

    expect(source).toContain("const skipTableDescriptionCommitRef = useRef(false)")
    expect(source).toContain("onEscapeKeyDown")
    expect(source).toContain('document.activeElement?.id === "table-description"')
    expect(source).toContain("event.preventDefault()")
    expect(commitIndex).toBeGreaterThan(-1)
    expect(commitGuardIndex).toBeGreaterThan(commitIndex)
    expect(commitGuardResetIndex).toBeGreaterThan(commitGuardIndex)
    expect(commitGuardReturnIndex).toBeGreaterThan(commitGuardResetIndex)
    expect(commitGuardReturnIndex).toBeLessThan(saveIndex)
    expect(dialogEscapeIndex).toBeGreaterThan(-1)
    expect(activeDescriptionIndex).toBeGreaterThan(dialogEscapeIndex)
    expect(dialogEscapePreventIndex).toBeGreaterThan(activeDescriptionIndex)
    expect(escapeIndex).toBeGreaterThan(-1)
    expect(escapeGuardIndex).toBeGreaterThan(escapeIndex)
    expect(escapeBlurIndex).toBeGreaterThan(escapeGuardIndex)
  })
})
