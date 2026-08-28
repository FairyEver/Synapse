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

  it("keeps column-description Escape inside the editor and restores its button", async () => {
    const source = await readFile(
      new URL("../components/table-schema-sheet.tsx", import.meta.url),
      "utf8",
    )

    const editorIndex = source.indexOf('data-track="database-column-description"')
    const escapeIndex = source.indexOf('e.key === "Escape"', editorIndex)
    const preventIndex = source.indexOf("e.preventDefault()", escapeIndex)
    const stopIndex = source.indexOf("e.stopPropagation()", escapeIndex)
    const restoreIndex = source.indexOf("restoreColumnDescriptionTriggerFocus", escapeIndex)

    expect(source).toContain("columnDescriptionTriggerRefs")
    expect(source).toContain('data-track="database-column-description-open"')
    expect(source).toContain('document.activeElement?.id.startsWith("column-description-")')
    expect(source).toContain('id={`column-description-${col.name}`}')
    expect(escapeIndex).toBeGreaterThan(editorIndex)
    expect(preventIndex).toBeGreaterThan(escapeIndex)
    expect(stopIndex).toBeGreaterThan(preventIndex)
    expect(restoreIndex).toBeGreaterThan(stopIndex)
  })

  it("restores focus to the table delete trigger after canceling confirmation", async () => {
    const source = await readFile(
      new URL("../components/table-schema-sheet.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("dropTableButtonRef")
    expect(source).toContain("onCloseAutoFocus")
    expect(source).toContain("dropTableButtonRef.current?.focus()")
  })

  it("restores focus to the schema trigger after closing the sheet", async () => {
    const source = await readFile(
      new URL("../components/table-schema-sheet.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("restoreFocusRef")
    expect(source).toContain("restoreFocusRef.current?.focus()")
  })

  it("falls back to New Table after deleting the current table", async () => {
    const source = await readFile(new URL("../index.tsx", import.meta.url), "utf8")
    const dropIndex = source.indexOf("const handleDropTable")
    const nextHandlerIndex = source.indexOf("const handleUpdateTableDescription", dropIndex)
    const dropHandler = source.slice(dropIndex, nextHandlerIndex)

    expect(dropHandler).toContain("createTableButtonRef.current?.focus()")
  })
})
