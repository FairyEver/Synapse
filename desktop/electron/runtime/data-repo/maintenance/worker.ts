import { parentPort, workerData } from "node:worker_threads"

import { runDataMaintenance } from "./engine"
import type { DataMaintenancePolicy } from "../types"

interface DataMaintenanceWorkerInput {
  readonly databasePath: string
  readonly policy: DataMaintenancePolicy
}

function parseInput(value: unknown): DataMaintenanceWorkerInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid data maintenance worker input")
  }
  const input = value as Partial<DataMaintenanceWorkerInput>
  if (typeof input.databasePath !== "string" || !input.policy) {
    throw new Error("Invalid data maintenance worker input")
  }
  return { databasePath: input.databasePath, policy: input.policy }
}

void runDataMaintenance({
  ...parseInput(workerData),
  onProgress: (progress) => parentPort?.postMessage({ type: "progress", progress }),
})
  .then((result) => parentPort?.postMessage({ type: "success", result }))
  .catch((error: unknown) => {
    parentPort?.postMessage({
      type: "error",
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
    })
  })
