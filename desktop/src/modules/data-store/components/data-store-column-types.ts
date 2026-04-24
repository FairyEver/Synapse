import type { DataStoreColumnType } from "@/types/data-store"

const DATA_STORE_COLUMN_TYPES: DataStoreColumnType[] = ["TEXT", "INTEGER", "REAL", "DATE", "DATETIME", "BOOLEAN", "ENUM", "MULTI_ENUM", "JSON", "BLOB"]

const DATA_STORE_COLUMN_TYPE_LABELS: Record<DataStoreColumnType, string> = {
  TEXT: "文本",
  INTEGER: "整数",
  REAL: "小数",
  DATE: "日期",
  DATETIME: "日期时间",
  BOOLEAN: "布尔",
  ENUM: "枚举",
  MULTI_ENUM: "多选枚举",
  BLOB: "二进制",
  JSON: "JSON",
}

function getDataStoreColumnTypeLabel(type: DataStoreColumnType): string {
  return DATA_STORE_COLUMN_TYPE_LABELS[type]
}

function getDataStoreColumnTypeDisplayName(type: string): string {
  if (type in DATA_STORE_COLUMN_TYPE_LABELS) {
    return DATA_STORE_COLUMN_TYPE_LABELS[type as DataStoreColumnType]
  }
  return type
}

const ENUM_SUMMARY_MAX_DISPLAY = 4

function formatEnumSummary(values: string[] | undefined | null, maxDisplay: number = ENUM_SUMMARY_MAX_DISPLAY): string | null {
  if (!values || values.length === 0) return null
  if (values.length <= maxDisplay) return values.join(", ")
  const shown = values.slice(0, maxDisplay).join(", ")
  return `${shown}… 共 ${values.length} 个`
}

export {
  DATA_STORE_COLUMN_TYPES,
  DATA_STORE_COLUMN_TYPE_LABELS,
  ENUM_SUMMARY_MAX_DISPLAY,
  formatEnumSummary,
  getDataStoreColumnTypeDisplayName,
  getDataStoreColumnTypeLabel,
}
