import type { Column } from "./types"
import { COLUMN_KINDS, isChoiceKind, isColumnKind } from "./column-kind"
import type { ColumnKind } from "./column-kind"

export const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
export const RESERVED_PREFIX = "_"
export const SYSTEM_COLUMN_NAMES = new Set(["id", "created_at", "updated_at"])

const MULTI_CHOICE_NAME_HINTS = ["tags", "labels", "categories", "标签", "分类", "类别"]
const SINGLE_CHOICE_NAME_HINTS = ["status", "priority", "level", "role", "severity", "gender", "优先级", "级别", "状态", "角色", "等级", "性别"]
const CHOICE_AMBIGUOUS_NAME_HINTS = ["category", "type", "kind", "tag", "label", "种类"]
const BOOLEAN_NAME_EXACT = ["done", "enabled", "active", "visible", "archived", "deleted", "published", "completed", "locked", "pinned", "starred", "favorite", "read"]
const BOOLEAN_NAME_PREFIXES = ["is_", "has_", "can_", "should_"]
const BOOLEAN_NAME_PREFIXES_CN = ["是否"]

export function validateName(name: string, kind: "table" | "column"): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid ${kind} name "${name}": must start with a letter, only letters, digits, underscores allowed`)
  }
  if (name.startsWith(RESERVED_PREFIX)) {
    throw new Error(`Invalid ${kind} name "${name}": names starting with "_" are reserved`)
  }
}

export function validateColumnName(name: string): void {
  validateName(name, "column")
  const lower = name.toLowerCase()
  if (lower === "id" || lower === "created_at" || lower === "updated_at") {
    throw new Error(`Column name "${name}" is reserved for system use`)
  }
}

export function validateColumnKind(kind: unknown): asserts kind is ColumnKind {
  if (typeof kind !== "string" || !isColumnKind(kind)) {
    throw new Error(`Invalid column kind "${String(kind)}": must be one of ${COLUMN_KINDS.join(", ")}`)
  }
}

export function validateChoicesConsistency(col: Column): void {
  if (isChoiceKind(col.kind)) {
    if (!Array.isArray(col.choices) || col.choices.length === 0) {
      throw new Error(`kind="${col.kind}" column "${col.name}" requires non-empty choices`)
    }
    const invalid = col.choices.find((choice) => typeof choice !== "string" || choice.length === 0)
    if (invalid !== undefined) {
      throw new Error(`kind="${col.kind}" column "${col.name}" choices must be non-empty strings`)
    }
    return
  }

  if (col.choices !== undefined) {
    throw new Error(`Column "${col.name}" has choices but kind="${col.kind}". choices only applies to single_choice or multi_choice`)
  }
}

export function assertSemanticallyCorrectColumn(col: Column): void {
  const lower = col.name.toLowerCase()

  if ((col.kind === "json" || col.kind === "text") && (MULTI_CHOICE_NAME_HINTS.includes(lower) || MULTI_CHOICE_NAME_HINTS.includes(col.name))) {
    throw new Error(
      `Column "${col.name}" is a multi-select field. Replace with: { name: "${col.name}", kind: "multi_choice", choices: ["..."] }.`,
    )
  }

  if ((col.kind === "json" || col.kind === "text") && (SINGLE_CHOICE_NAME_HINTS.includes(lower) || SINGLE_CHOICE_NAME_HINTS.includes(col.name))) {
    throw new Error(
      `Column "${col.name}" is a single-choice field. Replace with: { name: "${col.name}", kind: "single_choice", choices: ["..."] }.`,
    )
  }

  if ((col.kind === "json" || col.kind === "text") && CHOICE_AMBIGUOUS_NAME_HINTS.includes(lower)) {
    throw new Error(
      `Column "${col.name}" looks like a choice field. Replace with: { name: "${col.name}", kind: "single_choice", choices: ["..."] } or { name: "${col.name}", kind: "multi_choice", choices: ["..."] }.`,
    )
  }

  if (col.kind === "integer") {
    const looksBool =
      BOOLEAN_NAME_EXACT.includes(lower)
      || BOOLEAN_NAME_PREFIXES.some((p) => lower.startsWith(p))
      || BOOLEAN_NAME_PREFIXES_CN.some((p) => col.name.startsWith(p))
    if (looksBool) {
      throw new Error(
        `Column "${col.name}" is a boolean field. Replace with: { name: "${col.name}", kind: "boolean" }.`,
      )
    }
  }
}

export function validateSingleChoiceValue(key: string, value: unknown, choiceCols: Map<string, string[]>): void {
  const allowed = choiceCols.get(key)
  if (!allowed) return
  if (value === null || value === undefined || value === "") return
  const s = String(value)
  if (!allowed.includes(s)) {
    throw new Error(`Invalid value "${s}" for single_choice column "${key}". Allowed: ${allowed.join(", ")}`)
  }
}

export function validateMultiChoiceValue(key: string, value: unknown, choiceCols: Map<string, string[]>): void {
  const allowed = choiceCols.get(key)
  if (!allowed) return
  if (value === null || value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`multi_choice column "${key}" requires an array value`)
  }
  for (const item of value) {
    const s = String(item)
    if (!allowed.includes(s)) {
      throw new Error(`Invalid value "${s}" for multi_choice column "${key}". Allowed: ${allowed.join(", ")}`)
    }
  }
}
