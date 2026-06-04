import { parentPort, workerData } from "node:worker_threads"

import { toBuiltinToolErrorPayload } from "../services/builtin-tools/errors"
import { executeBuiltinToolInCurrentThread } from "../services/builtin-tools/worker-execute"

void executeBuiltinToolInCurrentThread(workerData)
  .then((output) => {
    parentPort?.postMessage({ type: "success", output })
  })
  .catch((error: unknown) => {
    parentPort?.postMessage({ type: "error", error: toBuiltinToolErrorPayload(error) })
  })

