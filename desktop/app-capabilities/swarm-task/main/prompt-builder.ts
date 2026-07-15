import type { SwarmTaskConfig, SwarmWorkerRun } from "../shared/schema"
import {
  SWARM_HANDOFF_CLOSE,
  SWARM_HANDOFF_OPEN,
  SWARM_SUMMARY_CLOSE,
  SWARM_SUMMARY_OPEN,
} from "../shared/prompt"

export type SwarmPromptHandoff = {
  readonly workerIndex: number
  readonly sequenceIndex: number
  readonly slotIndex: number
  readonly batchIndex: number
  readonly handoff: string
}

export type BuildSwarmWorkerPromptInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
  readonly sequenceIndex: number
  readonly slotIndex: number
  readonly batchIndex: number
  readonly config: SwarmTaskConfig
  readonly recentSummaries: readonly SwarmWorkerRun[]
  readonly previousHandoffs: readonly SwarmPromptHandoff[]
}

export type ExtractedSwarmOutput = {
  readonly summary?: string
  readonly handoff?: string
}

export const SWARM_PREVIOUS_HANDOFF_MAX_BYTES = 64 * 1024
export const SWARM_PREVIOUS_HANDOFF_MAX_ITEMS = 20

const handoffTruncatedMarker = "\n[handoff truncated to fit the context budget]"
const textEncoder = new TextEncoder()

export function buildSwarmWorkerPrompt(input: BuildSwarmWorkerPromptInput): string {
  const sections: string[] = []
  const injection = input.config.promptInjection

  if (injection.sequenceBatch.enabled) {
    sections.push(sequenceBatchSection(input))
  }

  if (injection.summary.enabled && injection.summary.injectRecent) {
    const summaries = input.recentSummaries
      .filter((item) => item.summary?.trim())
      .slice(-injection.summary.recentLimit)
    if (summaries.length > 0) {
      sections.push([
        "## Recent Summaries",
        ...summaries.map((item) => {
          const sequenceIndex = item.sequenceIndex ?? item.roundIndex
          const slotIndex = item.slotIndex ?? item.workerIndex
          return `- sequence ${sequenceIndex}, slot ${slotIndex}: ${item.summary?.trim()}`
        }),
      ].join("\n"))
    }
  }

  if (injection.previousHandoff.enabled && input.previousHandoffs.length > 0) {
    sections.push(previousHandoffSection(input.previousHandoffs))
  }

  const fileWrite = fileWriteSection(input.config)
  if (fileWrite) sections.push(fileWrite)

  const custom = injection.customAppendix.trim()
  if (custom) {
    sections.push(["## Prompt Appendix", custom].join("\n"))
  }

  sections.push([
    "## User Prompt",
    input.config.prompt,
  ].join("\n"))

  const ending = structuredEndingSection(input.config)
  if (ending) sections.push(ending)

  return sections.filter(Boolean).join("\n\n")
}

function sequenceBatchSection(input: BuildSwarmWorkerPromptInput): string {
  return [
    "## Swarm Sequence",
    `taskId: ${input.taskId}`,
    `runId: ${input.runId}`,
    `runMode: ${input.config.runMode}`,
    `concurrency: ${input.config.concurrency}`,
    `maxRounds: ${input.config.maxRounds}`,
    `sequenceIndex: ${input.sequenceIndex}`,
    `sequenceIndexZeroBased: ${input.sequenceIndex - 1}`,
    `slotIndex: ${input.slotIndex}`,
    `slotIndexZeroBased: ${input.slotIndex - 1}`,
    `batchIndex: ${input.batchIndex}`,
    `batchIndexZeroBased: ${input.batchIndex - 1}`,
  ].join("\n")
}

function previousHandoffSection(handoffs: readonly SwarmPromptHandoff[]): string {
  const selected = handoffs.slice(-SWARM_PREVIOUS_HANDOFF_MAX_ITEMS)
  let remainingBytes = SWARM_PREVIOUS_HANDOFF_MAX_BYTES
  let remainingItems = selected.length
  const rendered = selected.map((item) => {
    const itemBudget = Math.floor(remainingBytes / remainingItems)
    const handoff = fitTextToUtf8Budget(item.handoff.trim(), itemBudget)
    remainingBytes -= utf8ByteLength(handoff)
    remainingItems -= 1
    return [
      `### sequence ${item.sequenceIndex}, slot ${item.slotIndex}, batch ${item.batchIndex}`,
      handoff,
    ].join("\n")
  })
  const omittedCount = handoffs.length - selected.length

  return [
    "## Previous Handoff",
    ...(omittedCount > 0 ? [`[${omittedCount} earlier handoffs omitted]`] : []),
    ...rendered,
  ].join("\n")
}

function fitTextToUtf8Budget(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value

  const contentBudget = Math.max(0, maxBytes - utf8ByteLength(handoffTruncatedMarker))
  const characters: string[] = []
  let usedBytes = 0
  for (const character of value) {
    const characterBytes = utf8ByteLength(character)
    if (usedBytes + characterBytes > contentBudget) break
    characters.push(character)
    usedBytes += characterBytes
  }
  return `${characters.join("")}${handoffTruncatedMarker}`
}

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

function fileWriteSection(config: SwarmTaskConfig): string {
  const fileWrite = config.promptInjection.fileWrite
  const path = fileWrite.path.trim()
  if (!fileWrite.enabled || !path) return ""

  const lines = [
    "## File Write Rules",
    `Write file: ${path}`,
    `Mode: ${fileWrite.mode}`,
    "",
  ]

  if (fileWrite.mode === "append-only") {
    lines.push(
      "Before writing, read the current file content. Do not overwrite, rewrite, delete, or modify existing content. Only append new content to the end of the file.",
    )
  } else {
    lines.push(
      "You may insert, modify, reorganize, or delete existing content when the task requires it. Preserve unrelated user content.",
    )
  }

  if (fileWrite.lock.enabled) {
    lines.push(
      "",
      `Before changing the file, acquire an atomic lock directory named ${path}.lock. Release the lock after the write finishes. If the lock cannot be acquired, wait and retry instead of writing concurrently.`,
    )
  }

  return lines.join("\n")
}

function structuredEndingSection(config: SwarmTaskConfig): string {
  const lines = ["## Structured Ending Protocol"]
  if (config.promptInjection.summary.enabled) {
    lines.push(
      "End with a concise Summary block:",
      SWARM_SUMMARY_OPEN,
      "本轮完成的工作、产出、风险和建议。",
      SWARM_SUMMARY_CLOSE,
    )
  }
  if (config.promptInjection.previousHandoff.enabled) {
    lines.push(
      "End with a Handoff block for the next worker round:",
      SWARM_HANDOFF_OPEN,
      "给下一轮 worker 的接续信息。",
      SWARM_HANDOFF_CLOSE,
    )
  }
  return lines.length > 1 ? lines.join("\n") : ""
}

export function extractSwarmStructuredOutput(text: string): ExtractedSwarmOutput {
  return {
    ...extractBlock(text, SWARM_SUMMARY_OPEN, SWARM_SUMMARY_CLOSE, "summary"),
    ...extractBlock(text, SWARM_HANDOFF_OPEN, SWARM_HANDOFF_CLOSE, "handoff"),
  }
}

function extractBlock<K extends keyof ExtractedSwarmOutput>(
  text: string,
  open: string,
  close: string,
  key: K,
): Pick<ExtractedSwarmOutput, K> | Record<string, never> {
  const start = text.indexOf(open)
  if (start < 0) return {}
  const contentStart = start + open.length
  const end = text.indexOf(close, contentStart)
  if (end < 0) return {}
  const value = text.slice(contentStart, end).trim()
  return value ? { [key]: value } as Pick<ExtractedSwarmOutput, K> : {}
}
