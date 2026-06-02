import type { SQLInputValue } from "node:sqlite"
import type { ColumnKind } from "./column-kind"
import {
  isBooleanKind,
  isChoiceKind,
  isDateKind,
  isJsonSerializedKind,
  isMultiChoiceKind,
  isTimestampKind,
} from "./column-kind"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColumnMetaEntry {
  kind: ColumnKind
  choices?: string[]
}

type ColumnMetaMap = Map<string, ColumnMetaEntry>

// ---------------------------------------------------------------------------
// Internal helpers (re-exported for use in service.ts)
// ---------------------------------------------------------------------------

const INTEGER_WRITE_PATTERN = /^-?\d+$/
const DECIMAL_WRITE_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/

function toSqlValue(v: unknown): SQLInputValue {
  if (v === null || v === undefined) return null
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v
  if (ArrayBuffer.isView(v)) return v as NodeJS.ArrayBufferView
  return String(v)
}

function toIntegerSqlValue(column: string, value: unknown): SQLInputValue {
  if (typeof value === "bigint") return value
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) return value
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (INTEGER_WRITE_PATTERN.test(trimmed)) {
      const numeric = Number(trimmed)
      return Number.isSafeInteger(numeric) ? numeric : BigInt(trimmed)
    }
  }
  throw new Error(`Column "${column}" expects an integer value`)
}

function toDecimalSqlValue(column: string, value: unknown): SQLInputValue {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (DECIMAL_WRITE_PATTERN.test(trimmed)) {
      const numeric = Number(trimmed)
      if (Number.isFinite(numeric)) return numeric
    }
  }
  throw new Error(`Column "${column}" expects a decimal value`)
}

function toBooleanInt(v: unknown): number {
  if (v === true) return 1
  if (v === false) return 0
  throw new Error(`Invalid boolean value: ${JSON.stringify(v)}. Expected true or false`)
}

function validateDateString(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  if (!DATE_PATTERN.test(s)) {
    throw new Error(`Invalid date format: "${s}". Expected YYYY-MM-DD`)
  }
  const [y, m, d] = s.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`Invalid date: "${s}"`)
  }
  return s
}

function validateTimestampString(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  if (!TIMESTAMP_PATTERN.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Error(`Invalid timestamp format: "${s}". Expected ISO 8601`)
  }
  const [datePart] = s.split("T")
  const [y, m, d] = datePart.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`Invalid timestamp: "${s}"`)
  }
  return s
}

// ---------------------------------------------------------------------------
// Column set helpers — derived from a ColumnMetaMap
// ---------------------------------------------------------------------------

function getColumnsForTable(meta: ColumnMetaMap, predicate: (kind: ColumnKind) => boolean): Set<string> {
  const result = new Set<string>()
  for (const [name, entry] of meta) {
    if (predicate(entry.kind)) result.add(name)
  }
  return result
}

function getJsonColumns(meta: ColumnMetaMap): Set<string> {
  return getColumnsForTable(meta, isJsonSerializedKind)
}

function getBooleanColumns(meta: ColumnMetaMap): Set<string> {
  return getColumnsForTable(meta, isBooleanKind)
}

function getDateColumns(meta: ColumnMetaMap): Set<string> {
  return getColumnsForTable(meta, isDateKind)
}

function getTimestampColumns(meta: ColumnMetaMap): Set<string> {
  return getColumnsForTable(meta, isTimestampKind)
}

function getChoiceColumns(meta: ColumnMetaMap): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [name, entry] of meta) {
    if (isChoiceKind(entry.kind) && entry.choices) result.set(name, entry.choices)
  }
  return result
}

function getMultiChoiceColumns(meta: ColumnMetaMap): Set<string> {
  return getColumnsForTable(meta, isMultiChoiceKind)
}

function getNumericColumns(meta: ColumnMetaMap): Map<string, "integer" | "decimal"> {
  const result = new Map<string, "integer" | "decimal">()
  for (const [name, entry] of meta) {
    if (entry.kind === "integer" || entry.kind === "decimal") {
      result.set(name, entry.kind)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Write coercion — JS value → SQLite storage value
// ---------------------------------------------------------------------------

function convertWriteValue(
  key: string,
  value: unknown,
  jsonCols: Set<string>,
  boolCols: Set<string>,
  dateCols: Set<string>,
  timestampCols: Set<string>,
  multiChoiceCols?: Set<string>,
  numericCols?: Map<string, "integer" | "decimal">,
): SQLInputValue {
  if (value === null || value === undefined) return null
  if (multiChoiceCols?.has(key)) return toSqlValue(JSON.stringify(value))
  if (jsonCols.has(key)) return toSqlValue(JSON.stringify(value))
  if (boolCols.has(key)) return toBooleanInt(value)
  if (dateCols.has(key) && value !== null && value !== undefined && value !== "") {
    return validateDateString(value)
  }
  if (timestampCols.has(key) && value !== null && value !== undefined && value !== "") {
    return validateTimestampString(value)
  }
  const numericKind = numericCols?.get(key)
  if (numericKind === "integer") return toIntegerSqlValue(key, value)
  if (numericKind === "decimal") return toDecimalSqlValue(key, value)
  return toSqlValue(value)
}

// ---------------------------------------------------------------------------
// Read coercion — SQLite storage value → JS value (mutates row in place)
// ---------------------------------------------------------------------------

function parseReadRow(
  row: Record<string, unknown>,
  jsonCols: Set<string>,
  boolCols: Set<string>,
  multiChoiceCols: Set<string>,
): void {
  for (const col of jsonCols) {
    if (col in row && typeof row[col] === "string") {
      try { row[col] = JSON.parse(row[col] as string) } catch { /* keep as string */ }
    }
  }
  for (const col of boolCols) {
    if (col in row) {
      row[col] = row[col] === 1 || row[col] === true
    }
  }
  for (const col of multiChoiceCols) {
    if (col in row && typeof row[col] === "string") {
      try { row[col] = JSON.parse(row[col] as string) } catch { /* keep as string */ }
    }
  }
}

export type { ColumnMetaEntry, ColumnMetaMap }
export {
  // column set helpers
  getJsonColumns,
  getBooleanColumns,
  getDateColumns,
  getTimestampColumns,
  getChoiceColumns,
  getMultiChoiceColumns,
  getNumericColumns,
  // write coercion
  convertWriteValue,
  // read coercion
  parseReadRow,
  // low-level helpers re-exported for service.ts
  toSqlValue,
  toBooleanInt,
  toIntegerSqlValue,
  toDecimalSqlValue,
  validateDateString,
  validateTimestampString,
}
