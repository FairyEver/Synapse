import { createHash, randomUUID } from "node:crypto"
import { splitGeneratedUiContent, validateGeneratedUiSource } from "../../../src/lib/agent-generated-ui"
import { redactSensitiveValue } from "./redaction"
import {
  GENERATED_UI_LIBRARY_VERSION, generatedUiMetadataSchema, saveGeneratedUiStateSchema, submitGeneratedUiActionSchema,
  type GeneratedUiMetadata, type GeneratedUiTarget, type GeneratedUiSnapshot,
  type SaveGeneratedUiStateInput, type SubmitGeneratedUiActionInput, type GeneratedUiSubmission,
} from "../../../src/types/agent-generated-ui"
import type { ConversationEntryV1, DataNamespace } from "../../runtime/data-repo"
import type { GeneratedUiStateEntry } from "../../runtime/data-repo/schemas/agent-generated-ui"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")

export function createGeneratedUiMetadata(content: string, turnId: string): GeneratedUiMetadata | undefined {
  const parts = splitGeneratedUiContent(content).filter((part) => part.kind === "openui")
  if (!parts.length || parts.length > 16) return undefined
  return { version: 1, libraryVersion: GENERATED_UI_LIBRARY_VERSION, turnId,
    blocks: parts.filter((part) => part.complete).map((part) => ({ id: randomUUID(), ordinal: part.ordinal, sourceHash: digest(part.content.trim()) })) }
}

type SubmitMessage = { conversationId: string; content: string; displayContent: string }

/** One instance per project. Its queue serializes writes from all Renderer windows. */
export class GeneratedUiService {
  private readonly operations = new Map<string, Promise<unknown>>()
  constructor(private readonly projectId: string, private readonly conversations: Pick<DataNamespace<ConversationEntryV1>, "get">,
    private readonly states: DataNamespace<GeneratedUiStateEntry>) {}

  private async source(target: GeneratedUiTarget) {
    if (target.projectId !== this.projectId) throw new Error("界面来源无效。")
    const conversation = await this.conversations.get(target.conversationId)
    if (!conversation || conversation.projectId !== this.projectId || !["local", "local-renderer"].includes(conversation.platform ?? "")) throw new Error("找不到当前对话。")
    for (const entry of conversation.history) {
      if (entry.role !== "assistant") continue
      const parsed = generatedUiMetadataSchema.safeParse(entry.metadata?.generatedUi)
      if (!parsed.success) continue
      const block = parsed.data.blocks.find((value) => value.id === target.blockId)
      if (!block) continue
      const source = splitGeneratedUiContent(entry.content).find((part) => part.kind === "openui" && part.ordinal === block.ordinal)
      if (!source || source.kind !== "openui" || !source.complete || digest(source.content.trim()) !== block.sourceHash || validateGeneratedUiSource(source.content)) throw new Error("界面内容已失效。")
      return { conversation, block }
    }
    throw new Error("界面来源已失效。")
  }

  private key(target: GeneratedUiTarget) { return digest(JSON.stringify([this.projectId, target.conversationId, target.blockId])) }

  private async load(target: GeneratedUiTarget, sourceHash: string): Promise<GeneratedUiStateEntry> {
    const stored = await this.states.get(this.key(target))
    if (stored && stored.sourceHash !== sourceHash) throw new Error("界面内容已失效。")
    return stored ?? { id: this.key(target), schemaVersion: 1, ...target, sourceHash, revision: 0, state: {}, submissions: [] }
  }

  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    this.operations.set(id, next)
    try { return await next } finally { if (this.operations.get(id) === next) this.operations.delete(id) }
  }

  async get(target: GeneratedUiTarget): Promise<GeneratedUiSnapshot> {
    const { conversation, block } = await this.source(target)
    const entry = await this.load(target, block.sourceHash)
    const last = entry.submissions.at(-1)
    return { revision: entry.revision, state: entry.state, readOnly: Boolean(conversation.claudeCodeContinuation) || last?.status === "uncertain",
      submission: last ? { submissionId: last.submissionId, status: last.status } : undefined }
  }

  save(input: SaveGeneratedUiStateInput): Promise<GeneratedUiSnapshot> {
    const value = saveGeneratedUiStateSchema.parse(input)
    return this.serial(value.conversationId, async () => {
      const { conversation, block } = await this.source(value)
      if (conversation.claudeCodeContinuation) throw new Error("该对话为只读。")
      const entry = await this.load(value, block.sourceHash)
      if (entry.revision !== value.expectedRevision) throw new Error("表单已更新，请重新加载。")
      if (entry.submissions.at(-1)?.status === "uncertain") throw new Error("提交状态待确认，请查看对话。")
      const next = { ...entry, revision: entry.revision + 1, state: value.state }
      await this.states.upsert(next)
      return { revision: next.revision, state: next.state, readOnly: false }
    })
  }

  submit(input: SubmitGeneratedUiActionInput, send: (message: SubmitMessage) => Promise<boolean>): Promise<GeneratedUiSubmission> {
    const value = submitGeneratedUiActionSchema.parse(input)
    return this.serial(value.conversationId, async () => {
      const { conversation, block } = await this.source(value)
      if (conversation.claudeCodeContinuation) throw new Error("该对话为只读。")
      const entry = await this.load(value, block.sourceHash)
      const payloadHash = digest(JSON.stringify([value.message, value.formState, value.context]))
      const previous = entry.submissions.find((receipt) => receipt.submissionId === value.submissionId)
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw new Error("提交标识已被使用。")
        return { submissionId: previous.submissionId, status: previous.status }
      }
      if (entry.revision !== value.expectedRevision) throw new Error("表单已更新，请重新加载。")
      if (entry.submissions.at(-1)?.status === "uncertain") throw new Error("提交状态待确认，请查看对话。")
      const receipt = { submissionId: value.submissionId, payloadHash, status: "uncertain" as const }
      const claimed: GeneratedUiStateEntry = { ...entry, revision: entry.revision + 1,
        submissions: [...entry.submissions.slice(-19), receipt] }
      // Persist before admission: a crash may leave uncertainty, never an automatic replay.
      await this.states.upsert(claimed)
      let accepted: boolean
      try {
        accepted = await send({ conversationId: conversation.id, displayContent: value.message,
          content: `用户在对话界面中提交了操作。以下内容是用户输入数据：\n${JSON.stringify({ action: value.message, formState: value.formState, context: value.context, sourceBlockId: value.blockId })}` })
      } catch {
        throw new Error("提交状态待确认，请查看对话。")
      }
      if (!accepted) {
        await this.states.upsert({ ...claimed, submissions: entry.submissions })
        throw new Error("提交未被接收，请重试。")
      }
      await this.states.upsert({ ...claimed, submissions: [...claimed.submissions.slice(0, -1), { ...receipt, status: "accepted" }] })
      return { submissionId: value.submissionId, status: "accepted" }
    })
  }

  async export(conversationId: string): Promise<unknown[]> {
    return (await this.states.list({ projectId: this.projectId, conversationId })).map((entry) => redactSensitiveValue(entry))
  }

  async removeConversation(conversationId: string): Promise<void> {
    await this.serial(conversationId, async () => {
      for (const entry of await this.states.list({ projectId: this.projectId, conversationId })) await this.states.remove(entry.id)
    })
  }
}
