import type { CSSProperties } from "react"
import type { Column } from "@/types/database"

const DATA_TABLE_ID_COLUMN_WIDTH = 56
const DATA_TABLE_ACTION_COLUMN_WIDTH = 72
const DATA_TABLE_MIN_VALUE_COLUMN_WIDTH = 72
const DATA_TABLE_SYSTEM_TIME_COLUMN_WIDTH = 164
const DATA_TABLE_HEADER_EXTRA_WIDTH = 32

const DATA_TABLE_COLUMN_CLASS = "overflow-hidden"
const DATA_TABLE_STICKY_ACTION_COLUMN_CLASS = `${DATA_TABLE_COLUMN_CLASS} sticky right-0 z-10 bg-background`
const DATA_TABLE_RESIZABLE_HEAD_CLASS = "relative select-none"

let columnMeasureContext: CanvasRenderingContext2D | null | undefined

function getColumnMeasureContext(): CanvasRenderingContext2D | null {
  if (columnMeasureContext !== undefined) return columnMeasureContext
  columnMeasureContext = document.createElement("canvas").getContext("2d")
  return columnMeasureContext
}

function getTableTextFont(): string {
  const rootStyle = window.getComputedStyle(document.documentElement)
  const fontFamily = rootStyle.getPropertyValue("--font-sans").trim() || "sans-serif"
  return `12px ${fontFamily}`
}

function measureTableTextWidth(text: string): number {
  if (!text) {
    return 0
  }

  const context = getColumnMeasureContext()
  if (!context) {
    return text.length * 8
  }

  context.font = getTableTextFont()
  return context.measureText(text).width
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
): number {
  if (column.system && !column.primaryKey) {
    return DATA_TABLE_SYSTEM_TIME_COLUMN_WIDTH
  }

  const headerWidth = measureTableTextWidth(column.name) + DATA_TABLE_HEADER_EXTRA_WIDTH
  return Math.max(DATA_TABLE_MIN_VALUE_COLUMN_WIDTH, Math.ceil(headerWidth))
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
