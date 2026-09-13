import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { realpath } from "node:fs/promises"
import type { AgentTaskProgressEntryV1, DataNamespace } from "../../runtime/data-repo"
import { redactSensitiveValue } from "./redaction"

type Row = AgentTaskProgressEntryV1
export interface WorkReceipt {
  toolUseId: string
  toolName: string
  path?: string
  canonicalPath?: string
  version?: string
  range?: [number, number]
  totalLines?: number
  kind: "text" | "image" | "operation"
  complete: boolean
  presented: boolean
  outputHash: string
  outputPath?: string
  runtimeEvidence?: boolean
  sourceReceiptId?: string
  outputContentOffsetLines?: number
  inputSummary?: string
  executionStatus?: "returned" | "interrupted"
}
interface WorkUnit {
  id: string
  path: string
  canonicalPath?: string
  kind: "text" | "image"
  receipts: string[]
  processed: boolean
}
interface Finding {
  id: string
  value: string | number
  evidence: string[]
  conflict: boolean
  alternatives?: Array<{ value: string | number; evidence: string[] }>
}
export type TaskCompletionAssessment = import("../../../src/types/agent").SynapseTaskCompletionAssessment

interface State {
  repairs: number
  sequence: number
  revision: number
  sealed: boolean
  receipts: Map<string, WorkReceipt>
  units: Map<string, WorkUnit>
  findings: Map<string, Finding>
}

/** The SDK task metadata is a submission, not the authoritative completion state. */
export const TASK_PROGRESS_GUIDANCE = `For multi-file or multi-stage analysis, you MUST register and maintain an explicit inventory and evidence through native TaskCreate/TaskUpdate metadata.synapseProgress. Never replace full reading with sampling. Submit at most 32 units/findings per call:
{version:1, baseRevision:<latest Synapse receipt revision, initially 0>, units:[{id:<stable id>,path:<absolute original>,kind:"text"|"image",receipts:[<native Read tool_use_id>],processed:<true only after analysis>}], findings:[{id:<stable fact>,value:<concise string or number>,evidence:[<tool_use_id>]}], seal:<true only after the full inventory is registered>}. Empty arrays are allowed. Register inventory before processing; append remaining units before sealing. If an earlier inventory was sealed prematurely, use reopen:true to append missing units without removing prior scope, then seal after the full inventory is registered. You cannot shrink or replace registered scope. Correct a conflicting finding using resolves:true and evidence containing both the old and new sources. SDK tool success and Task completion are not proof of reading, visual understanding, or factual correctness. Use exact receipt paths/ranges and saved findings after maintenance; do not repeat external operations. A receipt of a shortened result does not cover the omitted original. Synapse reports scope coverage separately from semantic correctness. If task tools are unavailable, preserve an explicit progress file and report verification as unavailable; never claim host verification.`

export class TaskProgressValidationError extends Error {}

export class TaskProgressStore {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly owners = new Map<string, string>()
  constructor(private readonly rows: DataNamespace<Row>, private readonly projectId: string) {}

  session(conversationId: string, cwd: string, resolveScope?: (turnId: string, resume: boolean) => Promise<string>): TaskProgressSession {
    return new TaskProgressSession(this, conversationId, cwd, resolveScope)
  }

  async serialized<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action)
    this.tail = next.catch(() => undefined)
    return next
  }

  claim(conversationId: string, turnId: string, owner: string): void {
    this.owners.set(conversationId, `${turnId}:${owner}`)
  }
  async removeConversation(conversationId: string): Promise<void> {
    this.owners.delete(conversationId)
    await this.serialized(async () => {
      if (!this.rows.listWindow) throw new Error("任务进度存储不支持分页。")
      for (;;) {
        const page = await this.rows.listWindow({ filter: { projectId: this.projectId, conversationId }, limit: 100 })
        if (!page.length) return
        for (const row of page) await this.rows.remove(row.value.id)
      }
    })
  }
  fence(conversationId: string, turnId: string, owner: string): void {
    if (this.owners.get(conversationId) !== `${turnId}:${owner}`) throw new Error("旧执行代不能提交任务进度。")
  }

  async *entries(conversationId: string, turnId: string): AsyncGenerator<Row> {
    if (!this.rows.listWindow) throw new Error("任务进度存储不支持分页。")
    for (let offset = 0; ; offset += 100) {
      const page = await this.rows.listWindow({ filter: { projectId: this.projectId, conversationId, turnId },
        orderBy: "revision", order: "asc", offset, limit: 100 })
      for (const row of page) yield row.value
      if (page.length < 100) return
    }
  }

  async state(conversationId: string, turnId: string): Promise<State> {
    const state: State = { repairs: 0, sequence: 0, revision: 0, sealed: false, receipts: new Map(), units: new Map(), findings: new Map() }
    for await (const row of this.entries(conversationId, turnId)) {
      state.sequence = row.revision
      if (row.kind === "receipt") {
        const receipt = row.data as unknown as WorkReceipt
        state.receipts.set(receipt.toolUseId, receipt)
      } else if (row.kind === "presentation") {
        for (const id of row.data.ids as string[]) {
          const receipt = state.receipts.get(id)
          if (receipt) receipt.presented = true
        }
      } else if (row.kind === "assessment" && row.data.outputRepair === true) {
        state.repairs += 1
      } else if (row.kind === "commit") {
        state.revision += 1
        for (const unit of row.data.units as WorkUnit[]) state.units.set(unit.id, unit)
        for (const finding of row.data.findings as Finding[]) state.findings.set(finding.id, finding)
        if (row.data.reopen === true) state.sealed = false
        state.sealed ||= row.data.seal === true
      }
    }
    return state
  }

  async append(conversationId: string, turnId: string, owner: string, revision: number, kind: Row["kind"], data: Row["data"]): Promise<void> {
    this.fence(conversationId, turnId, owner)
    const row: Row = { id: digest(`${this.projectId}:${conversationId}:${turnId}:${revision}`), schemaVersion: 1,
      projectId: this.projectId, conversationId, turnId, revision, generationId: owner, kind, data }
    if (Buffer.byteLength(JSON.stringify(row)) > 64 * 1024) throw new TaskProgressValidationError("任务进度记录过大，请分批提交。")
    await this.rows.upsert(row)
  }

  async assessment(conversationId: string, turnId: string): Promise<TaskCompletionAssessment> {
    return assess(await this.state(conversationId, turnId))
  }

  async progressMarker(conversationId: string, turnId: string): Promise<string | undefined> {
    const state = await this.state(conversationId, turnId)
    if (!state.units.size) return undefined
    return digest(JSON.stringify([...state.units.values()].map((unit) => ({
      id: unit.id, processed: unit.processed, covered: covered(unit, state),
      sources: [...new Set(unit.receipts.map((id) => {
        const r = state.receipts.get(id)
        return r?.presented ? `${r.path}:${r.version}:${r.range?.join("-")}` : "pending"
      }))].sort(),
    })).sort((a, b) => a.id.localeCompare(b.id))))
  }

  async *checkpoint(conversationId: string, turnId: string): AsyncGenerator<string> {
    const state = await this.state(conversationId, turnId)
    yield JSON.stringify({ kind: "assessment", ...assess(state), inventorySealed: state.sealed, resume: resumeCapsule(state) })
    for (const unit of state.units.values()) yield JSON.stringify({ recordType: "unit", ...unit, covered: covered(unit, state) })
    for (const finding of state.findings.values()) yield JSON.stringify({ kind: "finding", ...finding })
    for (const receipt of state.receipts.values()) yield JSON.stringify({ recordType: "receipt", ...receipt })
  }
}

export class TaskProgressSession {
  private readonly owner = randomUUID()
  private turnId?: string
  private runtimeTurnId?: string
  constructor(private readonly store: TaskProgressStore, private readonly conversationId: string, private readonly cwd: string,
    private readonly resolveScope?: (turnId: string, resume: boolean) => Promise<string>) {}
  async begin(runtimeTurnId: string, resume = false): Promise<void> {
    if (this.runtimeTurnId === runtimeTurnId) return
    const turnId = await this.resolveScope?.(runtimeTurnId, resume) ?? runtimeTurnId
    await this.store.serialized(async () => {
      this.store.claim(this.conversationId, turnId, this.owner)
      this.turnId = turnId
      this.runtimeTurnId = runtimeTurnId
    })
  }
  private async mutate(action: (state: State, append: (kind: Row["kind"], data: Row["data"]) => Promise<void>) => Promise<string>): Promise<string> {
    const turnId = this.turnId
    if (!turnId) throw new Error("任务进度缺少当前轮次。")
    return this.store.serialized(async () => {
      this.store.fence(this.conversationId, turnId, this.owner)
      const state = await this.store.state(this.conversationId, turnId)
      return action(state, (kind, data) => this.store.append(this.conversationId, turnId, this.owner, state.sequence + 1, kind, data))
    })
  }
  async receipt(receipt: WorkReceipt, includeInventoryGuidance = true): Promise<string> {
    return this.mutate(async (state, append) => {
      // A native Read of an exact, host-saved result recovers that original range.
      // Bind by both canonical artifact identity and complete file hash, never by filename.
      if (receipt.kind === "text" && receipt.version && receipt.range && receipt.complete) {
        for (const source of state.receipts.values()) {
          if (source.kind !== "text" || !source.outputPath || !source.version || !source.range || source.outputHash !== receipt.version) continue
          let artifactPath: string
          try { artifactPath = await progressRealpath(source.outputPath) }
          catch { continue } // Missing artifacts cannot establish recovered evidence.
          if (artifactPath !== receipt.canonicalPath) continue
          const offset = source.outputContentOffsetLines ?? 0
          const range: [number, number] = [Math.max(source.range[0], source.range[0] + receipt.range[0] - offset - 1),
            Math.min(source.range[1], source.range[0] + receipt.range[1] - offset - 1)]
          if (range[1] < range[0]) continue
          receipt = { ...receipt, path: source.path, canonicalPath: source.canonicalPath, version: source.version,
            range, totalLines: source.totalLines, runtimeEvidence: source.runtimeEvidence, sourceReceiptId: source.toolUseId }
          break
        }
      }
      const old = state.receipts.get(receipt.toolUseId)
      if (old && (old.outputHash !== receipt.outputHash || old.path !== receipt.path || old.version !== receipt.version)) {
        throw new Error("相同工具回执标识对应不同结果，已保留原证据。")
      }
      if (!state.receipts.has(receipt.toolUseId)) await append("receipt", { ...receipt })
      return `Synapse receipt ${receipt.toolUseId}; revision=${state.revision}; acquired, model presentation unconfirmed. ${receipt.path ? JSON.stringify({ originalPath: receipt.path, range: receipt.range, complete: receipt.complete }) : ""}${includeInventoryGuidance && receipt.kind !== "operation" && !state.units.size ? " No inventory registered yet. Submit the complete file inventory with native TaskCreate metadata.synapseProgress before proceeding, then commit processed units and findings using the Read receipt IDs. This is required for task coverage verification." : ""}`
    })
  }
  async presented(ids: string[]): Promise<void> {
    await this.mutate(async (state, append) => {
      const pending = ids.filter((id) => state.receipts.has(id) && !state.receipts.get(id)!.presented)
      if (pending.length) await append("presentation", { ids: pending })
      return ""
    })
  }
  async claimOutputRepair(): Promise<boolean> {
    let claimed = false
    await this.mutate(async (state, append) => {
      if (!state.repairs) { await append("assessment", { outputRepair: true }); claimed = true }
      return ""
    })
    return claimed
  }
  async commit(value: unknown): Promise<string> {
    return this.mutate(async (state, append) => {
      const input = record(value)
      if (input.version !== 1 || input.baseRevision !== state.revision) throw new TaskProgressValidationError(`任务进度版本过期；当前 revision=${state.revision}。保留既有范围，读取交接进度或依据最新回执重新提交。`)
      const units: WorkUnit[] = []
      const unitIds = new Set<string>()
      for (const item of boundedArray(input.units)) {
        const u = record(item)
        const id = identifier(u.id), original = state.units.get(id)
        if (unitIds.has(id)) throw new TaskProgressValidationError("同一提交不能重复任务单元 ID。")
        unitIds.add(id)
        const filePath = path.resolve(this.cwd, identifier(u.path, 4096))
        if (u.kind !== "text" && u.kind !== "image") throw new TaskProgressValidationError("任务单元类型无效。")
        if (state.sealed && !original && input.reopen !== true) throw new TaskProgressValidationError("清单已封存；若遗漏材料，以 reopen:true 追加缺项，再重新封存；已有范围不能删除或替换。")
        if (original && (original.path !== filePath || original.kind !== u.kind)) throw new TaskProgressValidationError("不能替换已登记的任务单元。")
        let canonicalPath = original?.canonicalPath
        if (!canonicalPath) {
          try { canonicalPath = await progressRealpath(filePath) }
          catch { canonicalPath = undefined } // Future materials stay registered and uncovered.
        }
        if ([...state.units.values(), ...units].some((unit) => unit.id !== id && (unit.path === filePath
          || (canonicalPath !== undefined && unit.canonicalPath === canonicalPath)))) {
          throw new TaskProgressValidationError("同一材料须沿用已有任务单元 ID，不能重复计数。")
        }
        const receipts = [...new Set([...(original?.receipts ?? []), ...stringArray(u.receipts)])]
        for (const id of receipts) {
          const receipt = state.receipts.get(id)
          const sameResource = receipt && (receipt.path === filePath || receipt.canonicalPath === filePath || (canonicalPath !== undefined && receipt.canonicalPath === canonicalPath)
            || [...state.receipts.values()].some((previous) => previous.path === filePath && previous.canonicalPath !== undefined
              && previous.canonicalPath === receipt.canonicalPath && previous.version === receipt.version))
          if (!receipt || !sameResource || receipt.kind !== u.kind || !receipt.presented) {
            const available = [...state.receipts.values()].filter((r) => r.kind === u.kind && r.presented && r.complete
              && (r.path === filePath || (canonicalPath !== undefined && r.canonicalPath === canonicalPath)))
              .slice(-8).map((r) => ({ toolUseId: r.toolUseId, version: r.version, range: r.range }))
            throw new TaskProgressValidationError(`回执 ${id} 尚未呈现或不属于此任务单元。交接前取得的 ID 不能替代新 Read 回执；已呈现证据可依据版本核对后重新提交，无需为换 ID 重读：${JSON.stringify(available)}`)
          }
        }
        if (u.processed === true && !receipts.length) throw new TaskProgressValidationError("没有证据的任务单元不能声明已处理。")
        units.push({ id, path: filePath, canonicalPath, kind: u.kind, receipts, processed: original?.processed === true || u.processed === true })
      }
      const findings: Finding[] = []
      const findingIds = new Set<string>()
      for (const item of boundedArray(input.findings)) {
        const f = record(item), id = identifier(f.id), old = state.findings.get(id)
        if (findingIds.has(id)) throw new TaskProgressValidationError("同一提交不能重复发现 ID；冲突须保留来源后显式校正。")
        findingIds.add(id)
        if (typeof f.value !== "string" && !(typeof f.value === "number" && Number.isFinite(f.value))) throw new TaskProgressValidationError("发现必须是有来源的文本或有限数值。")
        if (typeof f.value === "string" && f.value.length > 2000) throw new TaskProgressValidationError("发现过长，请保存完整证据并提交简明结论。")
        const evidence = stringArray(f.evidence)
        if (!evidence.length || evidence.some((id) => !state.receipts.get(id)?.presented || !state.receipts.get(id)?.complete)) throw new TaskProgressValidationError("发现缺少完整且已呈现的证据。")
        const changed = old && old.value !== f.value
        const resolved = f.resolves === true && old?.evidence.every((id) => evidence.includes(id))
        const alternatives = (changed || old?.conflict) && !resolved
          ? [...(old?.alternatives ?? (old ? [{ value: old.value, evidence: old.evidence }] : [])), { value: redactSensitiveValue(f.value) as string | number, evidence }]
          : undefined
        if (alternatives && alternatives.length > 8) throw new TaskProgressValidationError("同一发现存在过多冲突，请先核对既有来源。")
        findings.push({ id, value: redactSensitiveValue(f.value) as string | number,
          evidence: changed || old?.conflict ? [...new Set([...(old?.evidence ?? []), ...evidence])] : evidence,
          conflict: Boolean((changed || old?.conflict) && !resolved), alternatives })
      }
      if (input.seal === true && (!state.sealed || input.reopen === true)) {
        const scope = new Map([...state.units, ...units.map((unit) => [unit.id, unit] as const)])
        const missing = [...new Set([...state.receipts.values()].filter((receipt) => receipt.kind !== "operation"
          && !receipt.runtimeEvidence && receipt.path && ![...scope.values()].some((unit) => unit.kind === receipt.kind
            && (unit.path === receipt.path || (unit.canonicalPath !== undefined && unit.canonicalPath === receipt.canonicalPath))))
          .map((receipt) => receipt.path!))]
        if (missing.length) throw new TaskProgressValidationError(`清单尚未包含已取得的 ${missing.length} 份材料，不能声明完整。先追加缺项后封存，已有任务不能省略：${JSON.stringify(missing.slice(0, 8))}`)
      }
      await append("commit", { units, findings, seal: input.seal === true, ...(input.reopen === true ? { reopen: true } : {}) })
      return `Synapse progress saved; revision=${state.revision + 1}. Scope coverage is independent of semantic correctness.`
    })
  }
  close(): void {
    if (this.turnId) {
      try { this.store.fence(this.conversationId, this.turnId, this.owner) } catch { return }
      this.store.claim(this.conversationId, this.turnId, "closed")
    }
  }
  async pendingProcessingBeforeRead(filePath: string): Promise<string | undefined> {
    if (!this.turnId) return undefined
    const state = await this.store.state(this.conversationId, this.turnId)
    if (!state.units.size) return undefined
    const absolute = path.resolve(this.cwd, filePath)
    const identities = new Map<string, Set<string>>()
    for (const receipt of state.receipts.values()) {
      if (!receipt.path || !receipt.canonicalPath || !receipt.version) continue
      const keys = identities.get(receipt.path) ?? new Set<string>()
      keys.add(`${receipt.canonicalPath}:${receipt.version}`)
      identities.set(receipt.path, keys)
    }
    const matching = (receipt: WorkReceipt, original: string) => receipt.path === original || receipt.canonicalPath === original
      || Boolean(receipt.canonicalPath && identities.get(original)?.has(`${receipt.canonicalPath}:${receipt.version}`))
    let canonicalTarget: string | undefined
    try { canonicalTarget = await progressRealpath(absolute) } catch { canonicalTarget = undefined }
    const target = [...state.units.values()].find((unit) => unit.path === absolute || (canonicalTarget !== undefined && unit.canonicalPath === canonicalTarget)
      || [...state.receipts.values()].some((r) => matching(r, unit.path) && r.canonicalPath === absolute))
    if (!target) return undefined // Progress/checkpoint reads and ordinary tools remain available.
    const pending = [...state.units.values()].filter((unit) => !unit.processed && unit.id !== target.id).flatMap((unit) => {
      const receipts = [...state.receipts.values()].filter((r) => r.kind === unit.kind && r.presented && r.complete && (matching(r, unit.path) || (unit.canonicalPath !== undefined && r.canonicalPath === unit.canonicalPath))).map((r) => r.toolUseId)
      return covered({ ...unit, receipts }, state) ? [{ id: unit.id, path: unit.path, kind: unit.kind, receipts }] : []
    })
    if (!pending.length) return undefined
    return `本次新材料读取尚未执行。此前材料已经完整呈现，但处理结果尚未提交；先保存已得出的答案/关键发现，并用 TaskUpdate.metadata.synapseProgress 提交这些单元的 receipts 和 processed 状态，再读取下一份材料。不要重跑已执行动作。当前 baseRevision=${state.revision}；待提交 ${pending.length} 项，前 8 项：${JSON.stringify(pending.slice(0, 8))}`
  }
  async needsInventory(): Promise<boolean> {
    if (!this.turnId) return false
    const state = await this.store.state(this.conversationId, this.turnId)
    return state.units.size === 0 && new Set([...state.receipts.values()]
      .filter((receipt) => receipt.kind !== "operation" && !receipt.runtimeEvidence).map((receipt) => receipt.canonicalPath ?? receipt.path)).size > 1
  }
  async assessment(): Promise<TaskCompletionAssessment | undefined> {
    return this.turnId ? this.store.assessment(this.conversationId, this.turnId) : undefined
  }
  async progressMarker(): Promise<string | undefined> {
    return this.turnId ? this.store.progressMarker(this.conversationId, this.turnId) : undefined
  }
}

/** Small complete rows for immediate continuation; omitted rows remain in the full index. */
function resumeCapsule(state: State): Record<string, unknown> {
  const capsule: Record<string, unknown> = {}
  const omitted: Record<string, number> = {}
  let bytes = 0
  const add = (key: string, rows: unknown[], max: number) => {
    const kept: unknown[] = []
    for (const row of rows) {
      const size = Buffer.byteLength(JSON.stringify(row)) + 1
      if (kept.length < max && bytes + size <= 5 * 1024) { kept.push(row); bytes += size }
    }
    capsule[key] = kept
    if (kept.length < rows.length) omitted[key] = rows.length - kept.length
  }
  const units = [...state.units.values()]
  add("completedUnitIds", units.filter((u) => u.processed && covered(u, state)).map((u) => u.id), 128)
  add("pendingUnitIds", units.filter((u) => !u.processed || !covered(u, state)).map((u) => u.id), 128)
  const operations = [...state.receipts.values()].filter((r) => r.kind === "operation")
  add("executedOperations", [...new Map([...operations.slice(0, 2), ...operations.slice(-4), ...operations].map((r) => [r.toolUseId, r])).values()]
    .map((r) => ({ toolUseId: r.toolUseId, inputSummary: r.inputSummary, executionStatus: r.executionStatus, outputPath: r.outputPath })), 6)
  add("findings", [...state.findings.values()].reverse(), 64)
  add("recentReads", [...state.receipts.values()].filter((r) => r.kind !== "operation" && !r.runtimeEvidence).reverse()
    .map((r) => ({ toolUseId: r.toolUseId, path: r.path, range: r.range, complete: r.complete, presented: r.presented })), 8)
  capsule.omittedRows = omitted
  return capsule
}

function covered(unit: WorkUnit, state: State): boolean {
  const receipts = unit.receipts.map((id) => state.receipts.get(id)).filter((r): r is WorkReceipt => Boolean(r?.presented && r.complete && r.version))
  const versions = new Set(receipts.map((r) => r.version))
  if (versions.size !== 1) return false
  if (unit.kind === "image") return receipts.length > 0
  const total = receipts[0]?.totalLines
  if (total === undefined || receipts.some((r) => r.totalLines !== total)) return false
  let cursor = 1
  for (const r of receipts.sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0))) {
    if (!r.range || r.range[0] > cursor) return false
    cursor = Math.max(cursor, r.range[1] + 1)
  }
  return cursor > total
}
function assess(state: State): TaskCompletionAssessment {
  const units = [...state.units.values()]
  const coveredUnits = units.filter((unit) => covered(unit, state)).length
  const processedUnits = units.filter((unit) => unit.processed && covered(unit, state)).length
  const conflictingFindings = [...state.findings.values()].filter((f) => f.conflict).length
  return { status: !units.length ? "unverified" : state.sealed && processedUnits === units.length && !conflictingFindings ? "coverage-complete" : "partial",
    revision: state.revision, declaredUnits: units.length, coveredUnits, processedUnits, conflictingFindings, semanticCorrectness: "unverified" }
}
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex") }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskProgressValidationError("任务进度格式无效。")
  return value as Record<string, unknown>
}
function identifier(value: unknown, limit = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new TaskProgressValidationError("任务进度标识无效。")
  return value
}
function boundedArray(value: unknown): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32) throw new TaskProgressValidationError("每次最多提交 32 项任务进度。")
  return value
}
function stringArray(value: unknown): string[] { return boundedArray(value).map((v) => identifier(v)) }

/** Filesystem mounts can stall. An unknown canonical identity must not hold a tool hook indefinitely. */
async function progressRealpath(filePath: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([realpath(filePath), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("任务材料路径验证超时。")), 3_000)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
