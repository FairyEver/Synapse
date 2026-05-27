import path from "node:path"
import { Worker } from "node:worker_threads"
import type {
  CcConversationDetail,
  CcConversationListInput,
  CcConversationListResult,
  CcRecordDetailsInput,
  CcRecordDetailsResult,
  CcRecordListInput,
  CcRecordListResult,
} from "../../../src/types/usage-analysis-conversations"

export type CcConversationWorkerInput =
  | {
    readonly dbPath: string
    readonly operation: "list"
    readonly payload: CcConversationListInput
  }
  | {
    readonly dbPath: string
    readonly operation: "search"
    readonly payload: CcConversationListInput
  }
  | {
    readonly dbPath: string
    readonly operation: "records"
    readonly payload: CcRecordListInput
  }
  | {
    readonly dbPath: string
    readonly operation: "records-search"
    readonly payload: CcRecordListInput
  }
  | {
    readonly dbPath: string
    readonly operation: "record-details"
    readonly payload: CcRecordDetailsInput
  }
  | {
    readonly dbPath: string
    readonly operation: "get"
    readonly payload: { readonly sessionId: string }
  }

export type CcConversationWorkerResult =
  | CcConversationListResult
  | CcConversationDetail
  | CcRecordListResult
  | CcRecordDetailsResult

type CcConversationWorkerMessage =
  | { readonly type: "success"; readonly result: CcConversationWorkerResult }
  | { readonly type: "error"; readonly error: { readonly name?: string; readonly message?: string; readonly stack?: string } }

type CcConversationWorkerRunner = (input: CcConversationWorkerInput) => Promise<CcConversationWorkerResult>

export function listCcConversationsInWorker(
  dbPath: string,
  input: CcConversationListInput,
): Promise<CcConversationListResult> {
  return runCcConversationQueryWithRunner({
    dbPath,
    operation: "list",
    payload: input,
  }, startCcConversationWorker) as Promise<CcConversationListResult>
}

export function listCcRecordsInWorker(
  dbPath: string,
  input: CcRecordListInput,
): Promise<CcRecordListResult> {
  return runCcConversationQueryWithRunner({
    dbPath,
    operation: "records",
    payload: input,
  }, startCcConversationWorker) as Promise<CcRecordListResult>
}

export function searchCcConversationTextInWorker(
  dbPath: string,
  input: CcConversationListInput,
): Promise<CcConversationListResult> {
  return runCcConversationQueryWithRunner({
    dbPath,
    operation: "search",
    payload: input,
  }, startCcConversationWorker) as Promise<CcConversationListResult>
}

export function searchCcRecordsTextInWorker(
  dbPath: string,
  input: CcRecordListInput,
): Promise<CcRecordListResult> {
  return runCcConversationQueryWithRunner({
    dbPath,
    operation: "records-search",
    payload: input,
  }, startCcConversationWorker) as Promise<CcRecordListResult>
}

export function listCcRecordDetailsInWorker(
  dbPath: string,
  input: CcRecordDetailsInput,
): Promise<CcRecordDetailsResult> {
  return runCcConversationQueryWithRunner({
    dbPath,
    operation: "record-details",
    payload: input,
  }, startCcConversationWorker) as Promise<CcRecordDetailsResult>
}

export function getCcConversationInWorker(dbPath: string, sessionId: string): Promise<CcConversationDetail> {
  return runCcConversationQueryWithRunner({
    dbPath,
    operation: "get",
    payload: { sessionId },
  }, startCcConversationWorker) as Promise<CcConversationDetail>
}

export function runCcConversationQueryWithRunner(
  input: CcConversationWorkerInput,
  runner: CcConversationWorkerRunner,
): Promise<CcConversationWorkerResult> {
  return runner(input)
}

function startCcConversationWorker(input: CcConversationWorkerInput): Promise<CcConversationWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveCcConversationWorkerPath(__dirname), {
      workerData: input,
    })
    let settled = false

    worker.once("message", (message: CcConversationWorkerMessage) => {
      settled = true
      if (message.type === "success") {
        resolve(message.result)
        return
      }
      reject(toConversationWorkerError(message.error))
    })
    worker.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      reject(new Error(`CC conversation worker exited with code ${code}`))
    })
  })
}

export function resolveCcConversationWorkerPath(baseDir: string): string {
  const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
  return path.join(workerBaseDir, "conversation-worker.js")
}

function toConversationWorkerError(error: { readonly name?: string; readonly message?: string; readonly stack?: string }): Error {
  const next = new Error(error.message || "CC conversation query failed")
  next.name = error.name || "CcConversationWorkerError"
  if (error.stack) next.stack = error.stack
  return next
}
