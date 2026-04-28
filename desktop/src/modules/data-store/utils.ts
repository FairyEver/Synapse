import type { DataStoreQueryResult, DataStoreTableSchema } from "@/types/data-store"

type DataStoreQueryState = {
  data: DataStoreQueryResult
  error: Error | null
  table: string | null
}

type DataStoreSchemaState = {
  error: Error | null
  schema: DataStoreTableSchema | null
  table: string | null
}

const EMPTY_DATA_STORE_QUERY_RESULT: DataStoreQueryResult = { rows: [], total: 0 }

function getCurrentDataStoreQueryResult(
  table: string | null,
  state: DataStoreQueryState,
): DataStoreQueryResult {
  return state.table === table ? state.data : EMPTY_DATA_STORE_QUERY_RESULT
}

function getCurrentDataStoreSchema(
  table: string | null,
  state: DataStoreSchemaState,
): DataStoreTableSchema | null {
  return state.table === table ? state.schema : null
}

function getCurrentDataStoreError(
  table: string | null,
  state: DataStoreQueryState | DataStoreSchemaState,
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

export {
  EMPTY_DATA_STORE_QUERY_RESULT,
  formatCreateTableSubmitError,
  getCurrentDataStoreError,
  getCurrentDataStoreQueryResult,
  getCurrentDataStoreSchema,
}
export type {
  DataStoreQueryState,
  DataStoreSchemaState,
}
