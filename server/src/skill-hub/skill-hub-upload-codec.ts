import { resolve } from "node:path"
import { Worker } from "node:worker_threads"
import { SKILL_HUB_LIMITS as limits, type SkillHubManifest, type SkillHubPackageInfo, type SkillHubUploadInput } from "@synapse/shared/skill-hub-contracts"
import { hubError } from "./skill-hub-error"

export type HubUploadBytes = {
  files: { kind: "archive" | "main" | "icon"; contentType: string; bytes: Uint8Array }[]
  package?: SkillHubPackageInfo & { manifest: SkillHubManifest; contentFingerprint: string }
}

export type HubUploadCodecResult = { data: HubUploadBytes } | { invalid: string }
export type HubUploadCodecInput = { purpose: SkillHubUploadInput["purpose"]; format?: "markdown" | "zip"; bytes: Uint8Array }

export function runHubUploadCodec(input: HubUploadCodecInput, signal: AbortSignal): Promise<HubUploadBytes> {
  return new Promise((resolveResult, reject) => {
    signal.throwIfAborted()
    const bytes = Uint8Array.from(input.bytes)
    const worker = new Worker(resolve(__dirname, "skill-hub-upload-worker.js"), {
      workerData: { ...input, bytes }, transferList: [bytes.buffer],
    })
    const timer = setTimeout(() => finish(hubError(400, "HUB_PACKAGE_BUDGET", "Skill 包校验超时，请缩小后重试。")), limits.parseTimeMs)
    const abort = () => finish(signal.reason)
    let finished = false
    function finish(error: unknown, result?: HubUploadBytes) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      // Wait for the worker to release its slot, including on timeout.
      void worker.terminate().then(() => error ? reject(error) : resolveResult(result!), reject)
    }
    signal.addEventListener("abort", abort, { once: true })
    worker.once("message", (message: HubUploadCodecResult) => {
      if ("invalid" in message) finish(hubError(400, "HUB_PACKAGE_INVALID", message.invalid))
      else finish(null, message.data)
    })
    worker.once("error", () => finish(hubError(503, "HUB_PACKAGE_CHECK_FAILED", "Skill 文件校验暂不可用，请重试。")))
    worker.once("exit", () => finish(hubError(503, "HUB_PACKAGE_CHECK_FAILED", "Skill 文件校验暂不可用，请重试。")))
  })
}
