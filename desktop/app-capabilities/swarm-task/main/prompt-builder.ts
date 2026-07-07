import type { SwarmTaskConfig, SwarmWorkerRun } from "../shared/schema"
import {
  SWARM_HANDOFF_CLOSE,
  SWARM_HANDOFF_OPEN,
  SWARM_SUMMARY_CLOSE,
  SWARM_SUMMARY_OPEN,
} from "../shared/prompt"

export type BuildSwarmWorkerPromptInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
  readonly config: SwarmTaskConfig
  readonly recentSummaries: readonly SwarmWorkerRun[]
  readonly previousHandoff?: string
}

export type ExtractedSwarmOutput = {
  readonly summary?: string
  readonly handoff?: string
}

export function buildSwarmWorkerPrompt(input: BuildSwarmWorkerPromptInput): string {
  const sections: string[] = []
  const inject = input.config.injectOptions

  const runtimeContext = runtimeContextSection(input)
  if (runtimeContext) sections.push(runtimeContext)

  if (input.config.summary.enabled && input.config.summary.injectRecent) {
    const summaries = input.recentSummaries
      .filter((item) => item.summary?.trim())
      .slice(-input.config.summary.recentLimit)
    if (summaries.length > 0) {
      sections.push([
        "## Recent Summaries",
        ...summaries.map((item) => `- Worker ${item.workerIndex}, round ${item.roundIndex}: ${item.summary?.trim()}`),
      ].join("\n"))
    }
  }

  if (input.config.handoff.enabled && input.previousHandoff?.trim()) {
    sections.push([
      "## Previous Handoff",
      input.previousHandoff.trim(),
    ].join("\n"))
  }

  if (inject.outputProtocol) {
    sections.push(outputProtocolSection(input.config))
  }

  if (inject.parallelContext || inject.gitContext || inject.customAppendix?.trim()) {
    sections.push(parallelContextSection(input.config))
  }

  sections.push([
    "## User Prompt",
    input.config.prompt,
  ].join("\n"))

  const ending = structuredEndingSection(input.config)
  if (ending) sections.push(ending)

  return sections.filter(Boolean).join("\n\n")
}

function runtimeContextSection(input: BuildSwarmWorkerPromptInput): string {
  const lines = ["## Swarm Runtime Context"]
  const inject = input.config.injectOptions

  if (inject.runContext) {
    lines.push(
      `Task: ${input.taskId}`,
      `Run: ${input.runId}`,
      `Run mode: ${input.config.runMode}`,
      `Workspace: ${input.config.workspacePath}`,
    )
  }
  if (inject.workerIdentity) {
    lines.push(`Worker: ${input.workerIndex}/${input.config.concurrency}`)
  }
  if (inject.roundContext) {
    lines.push(`Round: ${input.roundIndex}`)
  }

  return lines.length > 1 ? lines.join("\n") : ""
}

function outputProtocolSection(config: SwarmTaskConfig): string {
  const lines = [
    "## Output Protocol",
    `Output mode: ${config.output.mode}`,
    `Write policy: ${config.output.targetFilePolicy}`,
  ]
  if (config.output.managedDirectory) {
    lines.push(`Managed output directory: ${config.output.managedDirectory}`)
  }
  if (config.output.targetFile) {
    lines.push(`Target file: ${config.output.targetFile}`)
  }
  lines.push("If the user asks you to write output files, follow the output mode and write policy above.")
  return lines.join("\n")
}

function parallelContextSection(config: SwarmTaskConfig): string {
  const lines = ["## Parallel Coordination"]
  if (config.injectOptions.parallelContext) {
    lines.push("- Multiple workers may run in the same workspace. Avoid overwriting unrelated user or worker changes.")
  }
  if (config.injectOptions.gitContext) {
    lines.push("- If you use git, inspect git status and git diff before staging. Do not use git add .")
  }
  const custom = config.injectOptions.customAppendix?.trim()
  if (custom) lines.push(custom)
  return lines.join("\n")
}

function structuredEndingSection(config: SwarmTaskConfig): string {
  const lines = ["## Structured Ending Protocol"]
  if (config.summary.enabled) {
    lines.push(
      "End with a concise Summary block:",
      SWARM_SUMMARY_OPEN,
      "本轮完成的工作、产出、风险和建议。",
      SWARM_SUMMARY_CLOSE,
    )
  }
  if (config.handoff.enabled) {
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

export function fallbackSummary(text: string, maxLength = 2000): string {
  return text.trim().slice(0, maxLength)
}
