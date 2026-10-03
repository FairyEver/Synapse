import { MOBILE_WORKSPACE_FILES_LIMITS as LIMITS, type MobileIntentResult, type MobileIntentResultPayload, type MobileWorkspaceFilesIntent } from "@synapse/shared"

export interface WorkspaceFilesRelayOwner {
  readonly userId: string; readonly desktopClientInstanceId: string; readonly mobileClientInstanceId: string
}
export interface WorkspaceFilesPendingInput extends WorkspaceFilesRelayOwner { readonly intent: MobileWorkspaceFilesIntent }
type Pending = WorkspaceFilesPendingInput & {
  readonly fingerprint: string; readonly bytes: number; readonly timer: NodeJS.Timeout
  readonly listeners: Array<(result: MobileIntentResult) => void>
}
/** Transient correlation only. It never retains a completed source page. */
export class WorkspaceFilesPending {
  private readonly records = new Map<string, Pending>()
  constructor(private readonly failed: (owner: WorkspaceFilesRelayOwner, result: MobileIntentResult) => void) {}

  register(input: WorkspaceFilesPendingInput, wait: boolean): { readonly fresh: boolean; readonly result?: Promise<MobileIntentResult>; readonly rejection?: MobileIntentResult } {
    const key = ownerKey(input, input.intent.intentId)
    const fingerprint = canonical(input.intent)
    const existing = this.records.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { fresh: false, rejection: rejection(input.intent, "request_conflict") }
      if (wait && existing.listeners.length >= LIMITS.maxQueuedReadsPerMobile) return { fresh: false, rejection: rejection(input.intent, "busy") }
      return { fresh: false, ...(wait ? { result: this.listen(existing) } : {}) }
    }
    const control = isControl(input.intent)
    const bytes = Buffer.byteLength(JSON.stringify(input)) + Buffer.byteLength(fingerprint) + 256
    let sameMobile = 0
    let count = 0
    let retainedBytes = 0
    for (const record of this.records.values()) {
      if (isControl(record.intent) !== control) continue
      count += 1; retainedBytes += record.bytes
      if (record.userId === input.userId && record.mobileClientInstanceId === input.mobileClientInstanceId) sameMobile += 1
    }
    if (count >= (control ? LIMITS.maxControls : LIMITS.maxResults) || sameMobile >= (control ? LIMITS.maxControlsPerMobile : LIMITS.maxResultsPerMobile) || retainedBytes + bytes > (control ? LIMITS.maxControlBytes : LIMITS.maxResultBytes)) return { fresh: false, rejection: rejection(input.intent, "busy") }
    const timer = setTimeout(() => this.fail(key, "deadline_exceeded"), LIMITS.requestTimeoutMs)
    timer.unref?.()
    const pending: Pending = { ...input, fingerprint, bytes, timer, listeners: [] }
    this.records.set(key, pending)
    return { fresh: true, ...(wait ? { result: this.listen(pending) } : {}) }
  }

  accept(userId: string, authenticatedDesktopId: string, payload: MobileIntentResultPayload): boolean {
    if (payload.desktopClientInstanceId !== authenticatedDesktopId) return false
    const key = ownerKey({ userId, desktopClientInstanceId: authenticatedDesktopId, mobileClientInstanceId: payload.mobileClientInstanceId }, payload.result.intentId)
    const pending = this.records.get(key)
    if (!pending) return false
    const files = payload.result.workspaceFiles
    if (files) {
      if (files.sessionId !== pending.intent.sessionId || files.operation !== pending.intent.operation) return false
      if ("scopeId" in pending.intent && pending.intent.scopeId !== undefined && files.scopeId !== pending.intent.scopeId) return false
    } else if (payload.result.outcome !== "rejected") return false
    if (payload.result.sessionId !== undefined && payload.result.sessionId !== pending.intent.sessionId) return false
    this.records.delete(key)
    clearTimeout(pending.timer)
    for (const resolve of pending.listeners) resolve(payload.result)
    return true
  }

  abandon(input: WorkspaceFilesPendingInput): void {
    const key = ownerKey(input, input.intent.intentId)
    const record = this.records.get(key)
    if (!record) return
    this.records.delete(key); clearTimeout(record.timer)
    const result = rejection(record.intent, "relay_failed")
    for (const resolve of record.listeners) resolve(result)
  }

  disconnect(userId: string, mobileClientInstanceId: string): void {
    for (const [key, record] of this.records) if (record.userId === userId && record.mobileClientInstanceId === mobileClientInstanceId) this.fail(key, "relay_failed", false)
  }

  desktopPresence(userId: string, onlineIds: readonly string[]): void {
    const online = new Set(onlineIds)
    for (const [key, record] of this.records) if (record.userId === userId && !online.has(record.desktopClientInstanceId)) this.fail(key, "desktop_offline")
  }

  private listen(record: Pending): Promise<MobileIntentResult> {
    return new Promise(resolve => record.listeners.push(resolve))
  }
  private fail(key: string, code: string, notify = true): void {
    const record = this.records.get(key)
    if (!record) return
    this.records.delete(key); clearTimeout(record.timer)
    const result = rejection(record.intent, code)
    for (const resolve of record.listeners) resolve(result)
    if (notify) this.failed(record, result)
  }
}
function ownerKey(owner: WorkspaceFilesRelayOwner, intentId: string): string { return JSON.stringify([owner.userId, owner.desktopClientInstanceId, owner.mobileClientInstanceId, intentId]) }
function rejection(intent: MobileWorkspaceFilesIntent, code: string): MobileIntentResult { return { intentId: intent.intentId, sessionId: intent.sessionId, outcome: "rejected", code } }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
  return JSON.stringify(value)
}

function isControl(intent: MobileWorkspaceFilesIntent): boolean { return intent.operation === "cancel" || intent.operation === "close" }
