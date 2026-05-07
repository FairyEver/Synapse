import type { SQLInputValue } from "node:sqlite"
import type { DatabaseOrderBy, DatabaseWhereClause, DatabaseWhereCondition } from "./types"
import type { ColumnMetaMap } from "./type-coercion"
import { getBooleanColumns, getJsonColumns, getMultiChoiceColumns, toBooleanInt, toSqlValue } from "./type-coercion"

// ---------------------------------------------------------------------------
// Constants (duplicated from service.ts to avoid circular imports)
// ---------------------------------------------------------------------------

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED_PREFIX = "_"
const VALID_WHERE_OPS = new Set(["=", "!=", ">", "<", ">=", "<=", "LIKE", "CONTAINS"])
const VALID_ORDER_DIRS = new Set(["ASC", "DESC"])

function validateName(name: string, kind: "table" | "column"): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid ${kind} name "${name}": must start with a letter, only letters, digits, underscores allowed`)
  }
  if (name.startsWith(RESERVED_PREFIX)) {
    throw new Error(`Invalid ${kind} name "${name}": names starting with "_" are reserved`)
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function isWhereGroup(where: DatabaseWhereClause): where is { combinator: "all" | "any"; conditions: DatabaseWhereCondition[] } {
  return typeof where === "object"
    && where !== null
    && "combinator" in where
    && "conditions" in where
    && Array.isArray((where as { conditions: unknown }).conditions)
}

// ---------------------------------------------------------------------------
// buildWhere
// ---------------------------------------------------------------------------

function buildWhere(
  where: DatabaseWhereClause | undefined,
  tableMeta: ColumnMetaMap,
): { whereSQL: string; whereParams: SQLInputValue[] } {
  if (!where) return { whereSQL: "", whereParams: [] }

  const jsonCols = getJsonColumns(tableMeta)
  const boolCols = getBooleanColumns(tableMeta)
  const multiChoiceCols = getMultiChoiceColumns(tableMeta)

  const conditions: string[] = []
  const params: SQLInputValue[] = []

  const appendCondition = (cond: DatabaseWhereCondition) => {
    validateName(cond.field, "column")
    if (!VALID_WHERE_OPS.has(cond.op)) {
      throw new Error(`Invalid where operator "${cond.op}": must be one of =, !=, >, <, >=, <=, LIKE, CONTAINS`)
    }
    if (cond.op === "CONTAINS") {
      if (!multiChoiceCols.has(cond.field)) {
        throw new Error(`CONTAINS operator is only supported on multi_choice columns. Column "${cond.field}" is not multi_choice.`)
      }
      if (cond.value === null || cond.value === undefined) {
        throw new Error(`CONTAINS operator requires a non-null scalar value for column "${cond.field}".`)
      }
      if (typeof cond.value === "object") {
        throw new Error(`CONTAINS operator requires a scalar value (string, number, or boolean) for column "${cond.field}". Got ${Array.isArray(cond.value) ? "array" : "object"}. Example: { field: "${cond.field}", op: "CONTAINS", value: "<single item>" }`)
      }
      conditions.push(`EXISTS (SELECT 1 FROM json_each(${q(cond.field)}) WHERE value = ?)`)
      params.push(toSqlValue(cond.value))
      return
    }
    conditions.push(`${q(cond.field)} ${cond.op} ?`)
    if (boolCols.has(cond.field)) {
      params.push(toBooleanInt(cond.value))
    } else if (multiChoiceCols.has(cond.field)) {
      params.push(toSqlValue(JSON.stringify(cond.value)))
    } else {
      const val = jsonCols.has(cond.field) && cond.value != null && typeof cond.value === "object"
        ? JSON.stringify(cond.value)
        : cond.value
      params.push(toSqlValue(val))
    }
  }

  if (Array.isArray(where)) {
    for (const cond of where as DatabaseWhereCondition[]) {
      appendCondition(cond)
    }
  } else if (isWhereGroup(where)) {
    if (where.combinator !== "all" && where.combinator !== "any") {
      throw new Error(`Invalid where combinator "${where.combinator}": must be "all" or "any"`)
    }
    for (const cond of where.conditions) {
      appendCondition(cond)
    }
    if (conditions.length === 0) return { whereSQL: "", whereParams: [] }
    return { whereSQL: ` WHERE ${conditions.join(where.combinator === "all" ? " AND " : " OR ")}`, whereParams: params }
  } else {
    for (const [key, value] of Object.entries(where)) {
      validateName(key, "column")
      conditions.push(`${q(key)} = ?`)
      if (boolCols.has(key)) {
        params.push(toBooleanInt(value))
      } else if (multiChoiceCols.has(key)) {
        params.push(toSqlValue(JSON.stringify(value)))
      } else {
        const val = jsonCols.has(key) && value != null && typeof value === "object"
          ? JSON.stringify(value)
          : value
        params.push(toSqlValue(val))
      }
    }
  }

  if (conditions.length === 0) return { whereSQL: "", whereParams: [] }
  return { whereSQL: ` WHERE ${conditions.join(" AND ")}`, whereParams: params }
}

// ---------------------------------------------------------------------------
// buildOrderBy
// ---------------------------------------------------------------------------

function buildOrderBy(orderBy?: DatabaseOrderBy): string {
  if (!orderBy) return ""
  if (typeof orderBy === "string") {
    validateName(orderBy, "column")
    return ` ORDER BY ${q(orderBy)} ASC`
  }
  validateName(orderBy.field, "column")
  const dir = orderBy.dir.toUpperCase()
  if (!VALID_ORDER_DIRS.has(dir)) {
    throw new Error(`Invalid order direction "${orderBy.dir}": must be "asc" or "desc"`)
  }
  return ` ORDER BY ${q(orderBy.field)} ${dir}`
}

export { buildWhere, buildOrderBy }
