import type { ColumnKind } from "@/types/database"

const COLUMN_KINDS: ColumnKind[] = [
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "timestamp",
  "single_choice",
  "multi_choice",
  "json",
  "binary",
]

const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  text: "文本",
  integer: "整数",
  decimal: "小数",
  boolean: "是/否",
  date: "日期",
  timestamp: "时间戳",
  single_choice: "单选",
  multi_choice: "多选",
  json: "JSON",
  binary: "二进制",
}

function getColumnKindLabel(kind: ColumnKind): string {
  return COLUMN_KIND_LABELS[kind]
}

function getColumnKindDisplayName(kind: string): string {
  if (kind in COLUMN_KIND_LABELS) {
    return COLUMN_KIND_LABELS[kind as ColumnKind]
  }
  return kind
}

const CHOICES_SUMMARY_MAX_DISPLAY = 4

function formatChoicesSummary(values: string[] | undefined | null, maxDisplay: number = CHOICES_SUMMARY_MAX_DISPLAY): string | null {
  if (!values || values.length === 0) return null
  if (values.length <= maxDisplay) return values.join(", ")
  const shown = values.slice(0, maxDisplay).join(", ")
  return `${shown}… 共 ${values.length} 个`
}

export {
  CHOICES_SUMMARY_MAX_DISPLAY,
  COLUMN_KINDS,
  COLUMN_KIND_LABELS,
  formatChoicesSummary,
  getColumnKindDisplayName,
  getColumnKindLabel,
}
