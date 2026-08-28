import type { DatabaseQueryResult, DatabaseTableSchema } from "@/types/database"

type DatabaseQueryState = {
  data: DatabaseQueryResult
  error: Error | null
  table: string | null
}

type DatabaseSchemaState = {
  error: Error | null
  schema: DatabaseTableSchema | null
  table: string | null
}

const EMPTY_DATABASE_QUERY_RESULT: DatabaseQueryResult = { rows: [], total: 0 }

function getCurrentDatabaseQueryResult(
  table: string | null,
  state: DatabaseQueryState,
): DatabaseQueryResult {
  return state.table === table ? state.data : EMPTY_DATABASE_QUERY_RESULT
}

function getCurrentDatabaseSchema(
  table: string | null,
  state: DatabaseSchemaState,
): DatabaseTableSchema | null {
  return state.table === table ? state.schema : null
}

function getCurrentDatabaseError(
  table: string | null,
  state: DatabaseQueryState | DatabaseSchemaState,
): Error | null {
  return state.table === table ? state.error : null
}

function formatCreateTableSubmitError(error: unknown): string {
  const message = error instanceof Error ? error.message : ""

  const duplicateColumn = message.match(/Duplicate column name "([^"]+)"/)
  if (duplicateColumn) {
    return `列名 "${duplicateColumn[1]}" 重复`
  }

  const singleChoiceColumn = message.match(/Column "([^"]+)" is a single-choice field/)
  if (singleChoiceColumn) {
    return `列 "${singleChoiceColumn[1]}" 应使用单选并填写选项`
  }

  const multiChoiceColumn = message.match(/Column "([^"]+)" is a multi-select field/)
  if (multiChoiceColumn) {
    return `列 "${multiChoiceColumn[1]}" 应使用多选并填写选项`
  }

  const choiceColumn = message.match(/Column "([^"]+)" looks like a choice field/)
  if (choiceColumn) {
    return `列 "${choiceColumn[1]}" 应使用单选或多选`
  }

  if (/already exists/i.test(message)) {
    return "表名已存在"
  }

  return message || "创建失败"
}

function formatDatabaseFolderOperationError(
  action: "create" | "rename" | "delete" | "move",
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : ""
  if (
    (action === "create" || action === "rename")
    && /UNIQUE constraint failed: _table_folders\.name/i.test(message)
  ) {
    return "文件夹名称已存在"
  }

  return {
    create: "新建文件夹失败，请重试。",
    rename: "重命名文件夹失败，请重试。",
    delete: "删除文件夹失败，请重试。",
    move: "移动数据表失败，请重试。",
  }[action]
}

export {
  EMPTY_DATABASE_QUERY_RESULT,
  formatDatabaseFolderOperationError,
  formatCreateTableSubmitError,
  getCurrentDatabaseError,
  getCurrentDatabaseQueryResult,
  getCurrentDatabaseSchema,
}
export type {
  DatabaseQueryState,
  DatabaseSchemaState,
}
