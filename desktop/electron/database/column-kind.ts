const COLUMN_KINDS = [
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
] as const

type ColumnKind = (typeof COLUMN_KINDS)[number]
type SqliteAffinity = "TEXT" | "INTEGER" | "REAL" | "BLOB"

const VALID_COLUMN_KINDS = new Set<string>(COLUMN_KINDS)

function isColumnKind(value: string): value is ColumnKind {
  return VALID_COLUMN_KINDS.has(value)
}

function kindToAffinity(kind: ColumnKind): SqliteAffinity {
  switch (kind) {
    case "integer":
    case "boolean":
      return "INTEGER"
    case "decimal":
      return "REAL"
    case "binary":
      return "BLOB"
    default:
      return "TEXT"
  }
}

function affinityToKind(type: string): ColumnKind {
  const upper = type.toUpperCase()
  if (upper.startsWith("INT")) return "integer"
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) return "decimal"
  if (upper.includes("BLOB")) return "binary"
  return "text"
}

function isJsonSerializedKind(kind: ColumnKind): boolean {
  return kind === "json" || kind === "multi_choice"
}

function isBooleanKind(kind: ColumnKind): boolean {
  return kind === "boolean"
}

function isDateKind(kind: ColumnKind): boolean {
  return kind === "date"
}

function isTimestampKind(kind: ColumnKind): boolean {
  return kind === "timestamp"
}

function isChoiceKind(kind: ColumnKind): boolean {
  return kind === "single_choice" || kind === "multi_choice"
}

function isMultiChoiceKind(kind: ColumnKind): boolean {
  return kind === "multi_choice"
}

export {
  COLUMN_KINDS,
  affinityToKind,
  isBooleanKind,
  isChoiceKind,
  isColumnKind,
  isDateKind,
  isJsonSerializedKind,
  isMultiChoiceKind,
  isTimestampKind,
  kindToAffinity,
}
export type { ColumnKind, SqliteAffinity }
