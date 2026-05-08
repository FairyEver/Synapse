import type { Column } from "@/types/database"

const INTEGER_PATTERN = /^-?\d+$/
const DECIMAL_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

function parseStrictInteger(columnName: string, raw: string): number {
  const trimmed = raw.trim()
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new Error(`列 "${columnName}" 需要整数`)
  }

  return Number(trimmed)
}

function parseStrictDecimal(columnName: string, raw: string): number {
  const trimmed = raw.trim()
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new Error(`列 "${columnName}" 需要数字`)
  }

  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    throw new Error(`列 "${columnName}" 需要数字`)
  }

  return value
}

function parseRowEditorCellValue(column: Column, raw: string): unknown {
  if (raw === "") {
    return column.kind === "multi_choice" ? [] : null
  }

  if (column.kind === "integer") {
    return parseStrictInteger(column.name, raw)
  }

  if (column.kind === "decimal") {
    return parseStrictDecimal(column.name, raw)
  }

  if (column.kind === "json") {
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error(`列 "${column.name}" 的 JSON 格式不正确`)
    }
  }

  if (column.kind === "boolean") {
    if (raw === "true") return true
    if (raw === "false") return false
    return null
  }

  if (column.kind === "multi_choice") {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  return raw || null
}

export { parseRowEditorCellValue }
