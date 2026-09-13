import path from "node:path"
import { realpath } from "node:fs/promises"
import { isPathInside } from "../fs-utils"
import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { captureNativeReadVersion } from "./image-presentation"
import { digest, TASK_PROGRESS_GUIDANCE, type TaskProgressSession, type WorkReceipt } from "./task-progress"
import { measureToolOutput } from "./tool-output-governor"
import { redactSensitiveValue } from "./redaction"

/** Observe only successful native tool results, after SDK permission enforcement. */
export async function recordTaskToolResult(
  progress: TaskProgressSession, input: HookInput, governed: HookJSONOutput, cwd: string,
  protocolAvailable = true,
  evidence?: { outputPath?: string; runtimeEvidenceRoots?: readonly string[]; persist: (content: string) => Promise<{ storagePath: string; contentTruncated: boolean } | undefined> },
): Promise<{ context: string; receiptId?: string }> {
  if (input.hook_event_name !== "PostToolUse" || input.agent_id) return { context: "" }
  const toolInput = object(input.tool_input), response = object(input.tool_response)
  if ((input.tool_name === "TaskCreate" || input.tool_name === "TaskUpdate") && object(toolInput.metadata).synapseProgress !== undefined) {
    if (response.success === false || response.error) return { context: "" }
    return { context: await progress.commit(object(toolInput.metadata).synapseProgress) }
  }
  if (input.tool_name === "TaskCreate" || input.tool_name === "TaskUpdate") {
    const assessment = await progress.assessment()
    return { context: `Native task status was updated, but no durable scope/evidence was submitted. Synapse progress revision=${assessment?.revision ?? 0}; registered units=${assessment?.declaredUnits ?? 0}. ${input.tool_name === "TaskCreate" ? TASK_PROGRESS_GUIDANCE : "For file analysis, submit the inventory and source-backed findings with TaskUpdate.metadata.synapseProgress before marking the analysis complete."}` }
  }
  if (input.tool_name.startsWith("Task")) return { context: "" }
  const measurement = measureToolOutput(input.tool_name, input.tool_response)
  const text = measurement?.text ?? ""
  const rewritten = !("async" in governed) && governed.hookSpecificOutput?.hookEventName === "PostToolUse"
    && governed.hookSpecificOutput.updatedToolOutput !== undefined
  const receipt: WorkReceipt = { toolUseId: input.tool_use_id, toolName: input.tool_name,
    kind: "operation", complete: false, presented: false, outputHash: digest(measurement ? text : JSON.stringify(input.tool_response) ?? "") }
  if (input.tool_name !== "Read") {
    const safeInput = redactSensitiveValue(toolInput)
    receipt.inputSummary = JSON.stringify(safeInput).slice(0, 500)
    receipt.executionStatus = response.interrupted === true ? "interrupted" : "returned"
    const saved = await evidence?.persist(JSON.stringify({ toolUseId: input.tool_use_id, toolName: input.tool_name,
      toolInput: safeInput, ...(evidence.outputPath ? { fullOutputPath: evidence.outputPath } : { output: redactSensitiveValue(text) }),
      executionStatus: receipt.executionStatus,
      outputTextAvailable: measurement !== undefined,
    }))
    if (!saved || saved.contentTruncated) throw new Error("已执行操作的完整证据未能保存。")
    receipt.outputPath = saved.storagePath
    receipt.complete = measurement !== undefined && !rewritten
  }
  if (input.tool_name === "Read" && typeof toolInput.file_path === "string" && (response.type === "text" || response.type === "image")) {
    receipt.outputPath = evidence?.outputPath
    receipt.path = path.resolve(cwd, toolInput.file_path)
    receipt.kind = response.type
    const file = object(response.file)
    if (receipt.outputPath && typeof file.content === "string" && text.endsWith(file.content)) {
      receipt.outputContentOffsetLines = (text.slice(0, text.length - file.content.length).match(/\n/g) ?? []).length
    }
    receipt.complete = !rewritten && file.truncatedByTokenCap !== true
    if (response.type === "text" && integer(file.startLine) && integer(file.numLines) && integer(file.totalLines)
      && file.startLine >= 1 && file.startLine + file.numLines - 1 <= file.totalLines) {
      receipt.range = [file.startLine, file.startLine + file.numLines - 1]
      receipt.totalLines = file.totalLines
    }
    if (response.type === "text" && !receipt.range) receipt.complete = false
    try {
      const original = await captureNativeReadVersion(receipt.path, cwd, input.tool_use_id,
        response.type === "text" && receipt.range && typeof file.content === "string"
          ? { content: file.content, startLine: receipt.range[0], numLines: receipt.range[1] - receipt.range[0] + 1 } : undefined)
      receipt.canonicalPath = original.path
      receipt.version = original.sha256
      for (const root of evidence?.runtimeEvidenceRoots ?? []) {
        if (isPathInside(await realpath(root), original.path)) receipt.runtimeEvidence = true
      }
    } catch {
      // The native result remains evidence, but cannot prove coverage of a stable original.
      receipt.complete = false
    }
  }
  return { context: await progress.receipt(receipt, protocolAvailable), receiptId: receipt.toolUseId }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 }

/** SDK 0.3.245 exposes model-converted content at PostToolBatch, not the typed Read response. */
export function expectedNativeReadDelivery(value: unknown): { kind: "text" | "image"; hash: string } | undefined {
  const response = object(value), file = object(response.file)
  if (response.type === "text" && typeof file.content === "string" && integer(file.startLine)) {
    const start = file.startLine
    const delivered = file.content === ""
      ? "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>"
      : file.content.split("\n").map((line, i) => `${start + i}\t${line}`).join("\n")
    return { kind: "text", hash: digest(delivered) }
  }
  if (response.type === "image" && typeof file.base64 === "string" && typeof file.type === "string") {
    return { kind: "image", hash: digest(JSON.stringify([file.type, file.base64])) }
  }
  return undefined
}
export function nativeReadDeliveredHash(value: unknown, kind: "text" | "image"): string | undefined {
  if (kind === "text") return typeof value === "string" ? digest(value) : undefined
  if (!Array.isArray(value) || value.length !== 1 || object(value[0]).type !== "image") return undefined
  const source = object(object(value[0]).source)
  return source.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string"
    ? digest(JSON.stringify([source.media_type, source.data])) : undefined
}
