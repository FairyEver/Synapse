import { digest } from "./task-progress"

export interface AssistantOutputDiagnostic {
  source: "sdk-assistant-message"
  contentBytes: number
  contentHash: string
  repeatedParagraphs: number
  strayThinkingTags: number
  duplicateDelivery: boolean
}

/** Observe source messages before UI/history projection. Never deduplicate by text alone. */
export class AssistantOutputIntegrity {
  private readonly deliveries = new Map<string, string>()
  private suspect = false
  inspect(raw: Record<string, unknown>): AssistantOutputDiagnostic | undefined {
    if (raw.type !== "assistant" || raw.parent_tool_use_id != null || raw.error) return undefined
    const message = raw.message as { content?: Array<{ type?: string; text?: string }> } | undefined
    const text = Array.isArray(message?.content)
      ? message.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : ""
    if (!text) return undefined
    const contentHash = digest(text)
    const id = typeof raw.uuid === "string" ? raw.uuid : undefined
    const duplicateDelivery = id !== undefined && this.deliveries.get(id) === contentHash
    if (id) {
      this.deliveries.set(id, contentHash)
      if (this.deliveries.size > 128) this.deliveries.delete(this.deliveries.keys().next().value!)
    }
    // Quoted/code examples can intentionally contain repeated paragraphs or tags.
    const prose = text.replace(/```[^]*?```|~~~[^]*?~~~|`[^`\n]*`|^>.*$/gm, "")
    const paragraphs = new Map<string, number>()
    for (const p of prose.replace(/^\s*<\/?think>\s*$/gmi, "").split(/\n\s*\n/).map((p) => p.trim())) {
      if (p.length >= 160) paragraphs.set(p, (paragraphs.get(p) ?? 0) + 1)
    }
    const repeatedParagraphs = [...paragraphs.values()].filter((count) => count >= 3).reduce((sum, count) => sum + count, 0)
    const strayThinkingTags = (prose.match(/^\s*<\/?think>\s*$/gmi) ?? []).length
    if (!duplicateDelivery) this.suspect = repeatedParagraphs > 0 || strayThinkingTags > 0
    return { source: "sdk-assistant-message", contentBytes: Buffer.byteLength(text), contentHash,
      repeatedParagraphs, strayThinkingTags, duplicateDelivery }
  }
  needsRepair(): boolean { return this.suspect }
}
