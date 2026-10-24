import { AgentShareSnapshotsContext } from "../share/privacy-context"
import { useContext, useEffect, useMemo, useReducer } from "react"
import type { ActionEvent } from "@openuidev/react-lang"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import type { GeneratedUiSnapshot, GeneratedUiTarget } from "@/types/agent-generated-ui"
import { redactShareState } from "../share/redaction"

const logger = createRendererLogger("agent.generated-ui")
const SAVE_DELAY_MS = 400

class GeneratedUiController {
  snapshot: GeneratedUiSnapshot = { revision: 0, state: {}, readOnly: true }
  loading = true
  busy = false
  error: string | null = null
  private draft: Record<string, unknown> = {}
  private saved = "{}"
  private queue: Promise<unknown> = Promise.resolve()
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private generation = 0

  constructor(readonly target: GeneratedUiTarget, private readonly notify: () => void, private readonly readOnly = false, private readonly hideEmails = false, private readonly frozen?: GeneratedUiSnapshot, private readonly frozenRequired = false) {}
  private changed() { if (!this.disposed) this.notify() }
  private failed(cause: unknown) {
    this.error = cause instanceof Error ? cause.message : "界面操作失败，请重试。"
    logger.warn("agent.generated-ui.operation.failed", { errorName: cause instanceof Error ? cause.name : typeof cause })
    this.changed()
  }
  async restore() {
    this.disposed = false
    const generation = ++this.generation
    this.loading = true; this.error = null; this.changed()
    try {
      if (this.frozenRequired && !this.frozen) throw new Error("分享界面快照缺失，请重新生成。")
      const snapshot = this.frozen ?? await requireBridgeDomain("agent").getGeneratedUiState(this.target)
      if (this.disposed || generation !== this.generation) return
      this.snapshot = this.readOnly ? { ...snapshot, state: this.hideEmails ? redactShareState(snapshot.state) : snapshot.state, readOnly: true } : snapshot
      this.draft = this.snapshot.state; this.saved = JSON.stringify(this.snapshot.state)
    } catch (cause) { if (!this.disposed && generation === this.generation) this.failed(cause) }
    finally { if (generation === this.generation) { this.loading = false; this.changed() } }
  }
  stateChanged = (state: Record<string, unknown>) => {
    if (this.readOnly || this.disposed || this.loading || this.snapshot.readOnly || this.busy) return
    this.draft = state
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.persist().catch((cause) => this.failed(cause)) }, SAVE_DELAY_MS)
  }
  private async persist(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    const serialized = JSON.stringify(this.draft)
    const state = JSON.parse(serialized) as Record<string, unknown>
    const save = this.queue.then(async () => {
      if (serialized === this.saved) return
      const snapshot = await requireBridgeDomain("agent").saveGeneratedUiState({ ...this.target, expectedRevision: this.snapshot.revision, state })
      this.snapshot = snapshot; this.saved = serialized
    })
    this.queue = save.catch(() => undefined)
    return save
  }
  action = async (event: ActionEvent) => {
    if (this.readOnly || this.disposed || this.loading || this.snapshot.readOnly || this.busy || this.error) return
    if (event.type === "open_url") {
      try {
        const url = new URL(String(event.params?.url ?? ""))
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("链接无效。")
        await requireBridgeDomain("shell").openExternal(url.toString())
      } catch (cause) { this.failed(cause) }
      return
    }
    if (event.type !== "continue_conversation") return
    this.busy = true; this.changed()
    track({ component: "agent", name: "agent-generated-ui-submit", action: "click", eventKey: "agent.generated-ui.submit", metadata: { boundary: "renderer.agent.generated-ui", fieldCount: Object.keys(event.formState ?? {}).length } })
    try {
      this.draft = { ...this.draft, ...event.formState }
      await this.persist()
      if (this.disposed) return
      const result = await requireBridgeDomain("agent").submitGeneratedUiAction({
        ...this.target, submissionId: crypto.randomUUID(), expectedRevision: this.snapshot.revision,
        message: event.humanFriendlyMessage,
        // Named forms scope event.formState to their own fields, excluding bound
        // selectors. Include reactive values so remarks never hide the chosen range.
        formState: { ...Object.fromEntries(Object.entries(this.draft).filter(([key]) => key.startsWith("$"))), ...(event.formState ?? this.draft) },
        context: event.params?.context,
      })
      if (result.status !== "accepted") throw new Error("提交状态待确认，请查看对话。")
      if (this.disposed) return
      await this.restore()
    } catch (cause) { if (!this.disposed) this.failed(cause) }
    finally { this.busy = false; this.changed() }
  }
  dispose() {
    this.disposed = true
    this.generation++
    if (!this.readOnly && !this.loading && !this.snapshot.readOnly) void this.persist().catch((cause) => this.failed(cause))
    else if (this.timer) clearTimeout(this.timer)
  }
}

export function useGeneratedUi(target?: GeneratedUiTarget, readOnly = false, hideEmails = false) {
  const snapshots = useContext(AgentShareSnapshotsContext)
  const frozen = readOnly && target ? snapshots?.[target.blockId] : undefined
  const [, update] = useReducer((value: number) => value + 1, 0)
  const controller = useMemo(() => target ? new GeneratedUiController(target, update, readOnly, hideEmails, frozen, snapshots !== undefined) : undefined,
    [target?.projectId, target?.conversationId, target?.blockId, readOnly, hideEmails, frozen, snapshots])
  useEffect(() => {
    if (controller) void controller.restore()
    return () => controller?.dispose()
  }, [controller])
  return controller
}
