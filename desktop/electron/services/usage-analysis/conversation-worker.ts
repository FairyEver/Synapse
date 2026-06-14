import { DatabaseSync } from "node:sqlite"
import { parentPort, workerData } from "node:worker_threads"
import type {
  CcConversationChunkInput,
  CcConversationListInput,
  CcRecordDetailsInput,
} from "../../../src/types/usage-analysis-conversations"
import { CcConversationService } from "./cc-conversation-service"
import { initUsageAnalysisSchema } from "./db-schema"
import type {
  CcConversationWorkerInput,
  CcConversationWorkerResult,
} from "./conversation-runner"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asListInput(value: unknown): CcConversationListInput {
  if (!isRecord(value)) throw new Error("Invalid CC conversation list payload")
  const preset = value.preset
  if (preset !== "today" && preset !== "7d" && preset !== "30d" && preset !== "90d" && preset !== "all") {
    throw new Error("Invalid CC conversation range preset")
  }
  return value as CcConversationListInput
}

function asRecordDetailsInput(value: unknown): CcRecordDetailsInput {
  if (!isRecord(value) || typeof value.sessionId !== "string") {
    throw new Error("Invalid CC record details payload")
  }
  return value as CcRecordDetailsInput
}

function asConversationChunkInput(value: unknown): CcConversationChunkInput {
  if (!isRecord(value) || typeof value.sessionId !== "string") {
    throw new Error("Invalid CC conversation chunk payload")
  }
  return {
    sessionId: value.sessionId,
    ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    ...(typeof value.limit === "number" ? { limit: value.limit } : {}),
  }
}

function asConversationWorkerInput(value: unknown): CcConversationWorkerInput {
  if (!isRecord(value) || typeof value.dbPath !== "string") {
    throw new Error("Invalid CC conversation worker input")
  }
  if (
    value.operation === "list"
    || value.operation === "search"
    || value.operation === "records"
    || value.operation === "records-search"
  ) {
    return {
      dbPath: value.dbPath,
      operation: value.operation,
      payload: asListInput(value.payload),
    }
  }
  if (value.operation === "record-details") {
    return {
      dbPath: value.dbPath,
      operation: "record-details",
      payload: asRecordDetailsInput(value.payload),
    }
  }
  if (value.operation === "get" && isRecord(value.payload) && typeof value.payload.sessionId === "string") {
    return {
      dbPath: value.dbPath,
      operation: "get",
      payload: { sessionId: value.payload.sessionId },
    }
  }
  if (value.operation === "get-chunk") {
    return {
      dbPath: value.dbPath,
      operation: "get-chunk",
      payload: asConversationChunkInput(value.payload),
    }
  }
  throw new Error("Invalid CC conversation worker operation")
}

async function runConversationQuery(): Promise<CcConversationWorkerResult> {
  const input = asConversationWorkerInput(workerData)
  const db = new DatabaseSync(input.dbPath)
  try {
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("PRAGMA foreign_keys = ON")
    initUsageAnalysisSchema(db)
    const service = new CcConversationService({ db })

    if (input.operation === "get") {
      return await service.getConversation(input.payload.sessionId)
    }
    if (input.operation === "get-chunk") {
      return await service.getConversationChunk(input.payload.sessionId, input.payload.cursor, input.payload.limit)
    }
    if (input.operation === "search") {
      return await service.searchConversationText(input.payload)
    }
    if (input.operation === "records") {
      return service.listRecords(input.payload)
    }
    if (input.operation === "records-search") {
      return await service.searchRecordsText(input.payload)
    }
    if (input.operation === "record-details") {
      return service.listRecordDetails(input.payload)
    }
    return service.listConversations(input.payload)
  } finally {
    db.close()
  }
}

void runConversationQuery()
  .then((result) => {
    parentPort?.postMessage({ type: "success", result })
  })
  .catch((error: unknown) => {
    const queryError = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) }
    parentPort?.postMessage({ type: "error", error: queryError })
  })
