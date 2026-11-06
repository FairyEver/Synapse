import { parentPort, workerData } from "node:worker_threads"

const port = parentPort
if (!port) throw new Error("Automation cleanup requires a Worker port")
const { candidates, retiredExecutorTypes } = workerData as {
  readonly candidates: readonly { readonly id: string; readonly executorType: string }[]
  readonly retiredExecutorTypes: readonly string[]
}
let offset = 0
function sendBatch(): void {
  const ids: string[] = []
  while (offset < candidates.length && ids.length < 50) {
    const candidate = candidates[offset++]!
    if (retiredExecutorTypes.includes(candidate.executorType)) ids.push(candidate.id)
  }
  if (ids.length > 0) port!.postMessage({ ids })
  else {
    port!.postMessage({ done: true })
    port!.close()
  }
}
port.on("message", sendBatch)
sendBatch()
