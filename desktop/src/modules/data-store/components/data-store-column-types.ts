import type { DataStoreColumnType } from "@/types/data-store"

const DATA_STORE_COLUMN_TYPES: DataStoreColumnType[] = ["TEXT", "INTEGER", "REAL", "DATE", "DATETIME", "BOOLEAN", "JSON", "BLOB"]

const DATA_STORE_COLUMN_TYPE_LABELS: Record<DataStoreColumnType, string> = {
  TEXT: "文本",
  INTEGER: "整数",
  REAL: "小数",
  DATE: "日期",
  DATETIME: "日期时间",
  BOOLEAN: "布尔",
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

export {
  DATA_STORE_COLUMN_TYPES,
  DATA_STORE_COLUMN_TYPE_LABELS,
  getDataStoreColumnTypeDisplayName,
  getDataStoreColumnTypeLabel,
}
