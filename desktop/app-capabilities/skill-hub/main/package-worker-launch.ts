import path from "node:path"
import { Worker } from "node:worker_threads"
import { SKILL_HUB_LIMITS as limits } from "@synapse/shared/skill-hub-contracts"
import type { HubWorkerInput, HubWorkerOutput } from "./package-worker"
import { SkillHubDesktopError } from "./error"

export function runHubPackageWorker(input: HubWorkerInput, signal: AbortSignal): Promise<HubWorkerOutput> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const dir = __dirname.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
    const transfers: ArrayBuffer[] = []
    const standalone = (source: Uint8Array) => {
      const copy = Uint8Array.from(source)
      transfers.push(copy.buffer)
      return copy
    }
    const workerData = input.format === "directory"
      ? { ...input, files: input.files.map((file) => ({ ...file, bytes: standalone(file.bytes) })) }
      : { ...input, bytes: standalone(input.bytes) }
    const worker = new Worker(path.join(dir, "package-worker.js"), {
      workerData, transferList: transfers, resourceLimits: { maxOldGenerationSizeMb: 160 },
    })
    const timer = setTimeout(() => finish(new SkillHubDesktopError("HUB_PACKAGE_BUDGET", "Skill 包检查超时，请缩小文件后重试。")), limits.parseTimeMs)
    const abort = () => finish(signal.reason)
    let completed = false
    const unavailable = () => new SkillHubDesktopError("HUB_PREPARE_UNAVAILABLE", "本地 Skill 包检查暂不可用。")
    function finish(error: unknown, result?: HubWorkerOutput) {
      if (completed) return
      completed = true
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      void worker.terminate().then(() => error ? reject(error) : resolve(result!), reject)
    }
    signal.addEventListener("abort", abort, { once: true })
    worker.once("message", (message: { result?: HubWorkerOutput }) => {
      if (message.result) finish(null, message.result)
      else finish(new SkillHubDesktopError("HUB_PACKAGE_INVALID", "Skill 包无效：请检查主文件、附件路径和大小。"))
    })
    worker.once("error", () => finish(unavailable()))
    worker.once("exit", () => finish(unavailable()))
  })
}
