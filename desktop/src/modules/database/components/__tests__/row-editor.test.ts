import { describe, expect, it } from "vitest"

import { parseRowEditorCellValue } from "../row-editor-values"
import type { Column } from "@/types/database"

const integerColumn: Column = { name: "count_value", kind: "integer" }
const decimalColumn: Column = { name: "score_value", kind: "decimal" }

describe("parseRowEditorCellValue", () => {
  it("rejects partial integer and decimal input", () => {
    expect(() => parseRowEditorCellValue(integerColumn, "12abc")).toThrow(/count_value/)
    expect(() => parseRowEditorCellValue(decimalColumn, "1.2x")).toThrow(/score_value/)
  })

  it("keeps exact numeric input as numbers", () => {
    expect(parseRowEditorCellValue(integerColumn, "12")).toBe(12)
    expect(parseRowEditorCellValue(decimalColumn, "1.25")).toBe(1.25)
  })

  it("keeps empty numeric cells as null", () => {
    expect(parseRowEditorCellValue(integerColumn, "")).toBeNull()
    expect(parseRowEditorCellValue(decimalColumn, "")).toBeNull()
  })
})
