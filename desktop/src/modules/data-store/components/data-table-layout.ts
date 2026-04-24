import type { CSSProperties } from "react"
import type { Column } from "@/types/data-store"

const DATA_TABLE_ID_COLUMN_WIDTH = 56
const DATA_TABLE_ACTION_COLUMN_WIDTH = 72
const DATA_TABLE_MIN_VALUE_COLUMN_WIDTH = 72
const DATA_TABLE_MAX_VALUE_COLUMN_WIDTH = 360
const DATA_TABLE_SYSTEM_TIME_COLUMN_WIDTH = 164
const DATA_TABLE_HEADER_EXTRA_WIDTH = 32
const DATA_TABLE_CELL_EXTRA_WIDTH = 28

const DATA_TABLE_COLUMN_CLASS = "overflow-hidden"
const DATA_TABLE_STICKY_ACTION_COLUMN_CLASS = `${DATA_TABLE_COLUMN_CLASS} sticky right-0 z-10 bg-background`
const DATA_TABLE_RESIZABLE_HEAD_CLASS = "relative select-none"

const columnMeasureCanvas = document.createElement("canvas")
const columnMeasureContext = columnMeasureCanvas.getContext("2d")

function getTableTextFont(): string {
  const rootStyle = window.getComputedStyle(document.documentElement)
  const fontFamily = rootStyle.getPropertyValue("--font-sans").trim() || "sans-serif"
  return `12px ${fontFamily}`
}

function measureTableTextWidth(text: string): number {
  if (!text) {
    return 0
  }

  if (!columnMeasureContext) {
    return text.length * 8
  }

  columnMeasureContext.font = getTableTextFont()
  return columnMeasureContext.measureText(text).width
}

function clampColumnWidth(width: number): number {
  return Math.min(DATA_TABLE_MAX_VALUE_COLUMN_WIDTH, Math.max(DATA_TABLE_MIN_VALUE_COLUMN_WIDTH, Math.ceil(width)))
}

function formatCellValue(value: unknown, type?: string, columnName?: string): string {
  if (value == null) return ""
  if (columnName === "created_at" || columnName === "updated_at") {
    return formatSystemTime(value)
  }
  if (type === "boolean") {
    return value === true || value === 1 ? "✓" : "✗"
  }
  if (type === "multi_choice" && Array.isArray(value)) {
    return value.join(", ")
  }
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function formatSystemTime(value: unknown): string {
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  const hours = padDatePart(date.getHours())
  const minutes = padDatePart(date.getMinutes())
  const seconds = padDatePart(date.getSeconds())
  return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0")
}

function getDefaultColumnWidth(
  column: Column,
  rows: Record<string, unknown>[],
): number {
  if (column.system && !column.primaryKey) {
    return DATA_TABLE_SYSTEM_TIME_COLUMN_WIDTH
  }

  const headerWidth = measureTableTextWidth(column.name) + DATA_TABLE_HEADER_EXTRA_WIDTH
  const contentWidth = rows.reduce((maxWidth, row) => {
    const valueText = formatCellValue(row[column.name], column.kind, column.name)
    return Math.max(maxWidth, measureTableTextWidth(valueText) + DATA_TABLE_CELL_EXTRA_WIDTH)
  }, 0)

  return clampColumnWidth(Math.max(headerWidth, contentWidth))
}

function getColumnWidthStyle(width: number): CSSProperties {
  return {
    width,
    minWidth: width,
    maxWidth: width,
  }
}

export {
  DATA_TABLE_ACTION_COLUMN_WIDTH,
  DATA_TABLE_COLUMN_CLASS,
  DATA_TABLE_STICKY_ACTION_COLUMN_CLASS,
  DATA_TABLE_ID_COLUMN_WIDTH,
  DATA_TABLE_MIN_VALUE_COLUMN_WIDTH,
  DATA_TABLE_RESIZABLE_HEAD_CLASS,
  DATA_TABLE_SYSTEM_TIME_COLUMN_WIDTH,
  formatCellValue,
  getColumnWidthStyle,
  getDefaultColumnWidth,
}
