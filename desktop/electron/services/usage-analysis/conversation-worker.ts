import { DatabaseSync } from "node:sqlite"
import { parentPort, workerData } from "node:worker_threads"
import type { CcConversationListInput } from "../../../src/types/usage-analysis-conversations"
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

function asConversationWorkerInput(value: unknown): CcConversationWorkerInput {
  if (!isRecord(value) || typeof value.dbPath !== "string") {
    throw new Error("Invalid CC conversation worker input")
  }
  if (value.operation === "list" || value.operation === "search") {
    return {
      dbPath: value.dbPath,
      operation: value.operation,
      payload: asListInput(value.payload),
    }
  }
  if (value.operation === "get" && isRecord(value.payload) && typeof value.payload.sessionId === "string") {
    return {
      dbPath: value.dbPath,
      operation: "get",
      payload: { sessionId: value.payload.sessionId },
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
    if (input.operation === "search") {
      return await service.searchConversationText(input.payload)
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
