import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type { SynapseAgentClaudeCodeContinuation } from "../../../src/types/agent"
import type { AgentSessionRepository } from "./session-repository"

const READ_ONLY_MESSAGE = "该对话已转交或正在转交 Claude Code，请在 Claude Code 中继续。"

export interface ClaudeCodeContinuationLauncher {
  validate(selection: SynapseAgentClaudeCodeContinuation): Promise<void>
  terminalStatus(sessionId: string): Promise<"running" | "ended" | "missing" | "unknown">
  launch(selection: SynapseAgentClaudeCodeContinuation, created: (sessionId: string) => Promise<void>): Promise<string>
}

/** Shares admission with every Agent writer; a CLI never overlaps an SDK query. */
export class ClaudeCodeContinuationManager {
  private readonly transfers = new Map<string, Promise<string>>()
  private readonly writers = new Map<string, number>()
  private readonly blocked = new Set<string>()

  constructor(private readonly deps: {
    repository: AgentSessionRepository
    isIdle(conversationId: string): boolean
    selection(conversation: ConversationEntryV1): Promise<SynapseAgentClaudeCodeContinuation>
    stop(conversationId: string): Promise<void>
    changed(conversation: ConversationEntryV1): void
  }) {}

  async runWritable<T>(conversationId: string, operation: () => Promise<T>): Promise<T> {
    const conversation = await this.deps.repository.get(conversationId)
    if (this.transfers.has(conversationId) || this.blocked.has(conversationId) || conversation?.claudeCodeContinuation) {
      throw new Error(READ_ONLY_MESSAGE)
    }
    this.writers.set(conversationId, (this.writers.get(conversationId) ?? 0) + 1)
    try {
      return await operation()
    } finally {
      const remaining = (this.writers.get(conversationId) ?? 1) - 1
      if (remaining) this.writers.set(conversationId, remaining)
      else this.writers.delete(conversationId)
    }
  }

  resume(conversationId: string, launcher: ClaudeCodeContinuationLauncher): Promise<string> {
    const existing = this.transfers.get(conversationId)
    if (existing) return existing
    // Register before any asynchronous lookup, including a concurrent send admission.
    const transfer = Promise.resolve().then(() => this.transfer(conversationId, launcher))
    this.transfers.set(conversationId, transfer)
    const release = () => { this.transfers.delete(conversationId) }
    void transfer.then(release, release)
    return transfer
  }

  private async save(conversationId: string, value: ConversationEntryV1["claudeCodeContinuation"]): Promise<void> {
    const updated = await this.deps.repository.saveClaudeCodeContinuation(conversationId, value)
    this.deps.changed(updated)
  }

  private async transfer(conversationId: string, launcher: ClaudeCodeContinuationLauncher): Promise<string> {
    const conversation = await this.deps.repository.get(conversationId)
    if (!conversation || conversation.platform !== "local-renderer") throw new Error("只能接续本地用户对话。")
    if (this.writers.has(conversationId) || !this.deps.isIdle(conversationId)) throw new Error("请等待当前对话执行和排队结束后再转到 Claude Code。")
    const previous = conversation.claudeCodeContinuation
    let selection = previous ?? await this.deps.selection(conversation)
    if (selection.terminalSessionId) {
      const status = await launcher.terminalStatus(selection.terminalSessionId)
      if (status === "running") {
        await this.save(conversationId, { ...selection, phase: "transferred" })
        return selection.terminalSessionId
      }
      if (status === "unknown") throw new Error("无法确认 Claude Code 终端状态，请稍后重试。")
    }
    await launcher.validate(selection)
    this.blocked.add(conversationId)
    let stopAttempted = false
    let stopped = false
    let launchAttempted = false
    try {
      await this.save(conversationId, selection)
      stopAttempted = true
      await this.deps.stop(conversationId)
      stopped = true
      selection = { ...selection, phase: "launching", terminalSessionId: undefined }
      await this.save(conversationId, selection)
      launchAttempted = true
      const terminalSessionId = await launcher.launch(selection, async (sessionId) => {
        // Persist the association before the PTY is spawned, including crash recovery.
        selection = { ...selection, terminalSessionId: sessionId }
        await this.save(conversationId, selection)
      })
      await this.save(conversationId, { ...selection, phase: "transferred", terminalSessionId })
      return terminalSessionId
    } catch (error) {
      // Never restore UI writes after a confirmed transfer or an uncertain process stop.
      const status = selection.terminalSessionId
        ? await launcher.terminalStatus(selection.terminalSessionId)
        : "missing"
      if ((!previous || previous.phase === "stopping")
        && (!stopAttempted || (stopped && (!launchAttempted || status === "missing" || status === "ended")))) {
        await this.save(conversationId, undefined)
        this.blocked.delete(conversationId)
      }
      throw error
    }
  }
}
