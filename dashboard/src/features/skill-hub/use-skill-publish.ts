import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  SkillHubDeleteResult, SkillHubReceiptInput, SkillHubReceiptResult, SkillHubWriteAction, SkillHubWriteReplay, SkillHubWriteResult,
} from '@synapse/shared/skill-hub-contracts'
import { skillHubIdSchema, skillHubReceiptInputSchema } from '@synapse/shared/skill-hub-contracts'
import { ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { assertHubSession, skillHubApi, type HubTeams } from './skill-hub-api'
import { hubScope } from './use-skill-hub'

type WriteOutcome = SkillHubReceiptResult['outcome']
type WriteResult = SkillHubWriteResult | SkillHubDeleteResult | SkillHubWriteReplay
type Result = { state: 'committed'; outcome?: WriteOutcome }
  | { state: 'unknown'; request: SkillHubReceiptInput }
  | { state: 'rejected'; error: ApiError }
type Tracker = { remember(request: SkillHubReceiptInput): void; clear(): void }
type Send = (id: string) => Promise<WriteResult>

export function resolveHubUploadTeam(teams: HubTeams | undefined, selected?: string) {
  if (!teams || teams.selectionState === 'none') return undefined
  const candidate = teams.selectionState === 'single' ? teams.defaultTeamId : selected
  return candidate && teams.items.some((team) => team.id === candidate) ? candidate : undefined
}

async function readHubReceipt(session: string, request: SkillHubReceiptInput, tracker: Tracker): Promise<Result> {
  try {
    const receipt = await skillHubApi.receipt(session, request)
    if (receipt.status === 'committed') {
      tracker.clear()
      return { state: 'committed', outcome: receipt.result?.outcome }
    }
  } catch {
    // If the original session is unavailable, preserve its key. A new account cannot settle this write.
    return { state: 'unknown', request }
  }
  return { state: 'unknown', request }
}

export async function submitHubWrite(session: string, request: SkillHubReceiptInput, send: () => Promise<WriteResult>, tracker: Tracker, previousUnknown = false): Promise<Result> {
  tracker.remember(request)
  try {
    const value = await send()
    if ('replayed' in value && value.receipt.status !== 'committed') return readHubReceipt(session, request, tracker)
    tracker.clear()
    return { state: 'committed', outcome: 'replayed' in value ? value.receipt.result?.outcome : value.outcome }
  } catch (error) {
    if (!previousUnknown && error instanceof ApiError && error.status >= 400 && error.status < 500
      && error.status !== 408 && error.code !== 'HUB_ACCOUNT_CHANGED' && error.code !== 'HUB_REQUEST_CONFLICT') {
      tracker.clear()
      return { state: 'rejected', error }
    }
    return readHubReceipt(session, request, tracker)
  }
}

const memory = new Map<string, string>()
const listeners = new Set<() => void>()
let intentRevision = 0
export const subscribeHubIntents = (listener: () => void) => {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(intentRoot)) { intentRevision++; listener() }
  }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}
export const getHubIntentRevision = () => intentRevision
const intentRoot = 'synapse.hub.write:'
const intentKey = (accountId: string, action: SkillHubWriteAction, target: string) => `${intentRoot}${accountId}:${action}:${target}`

function accountForSession(session: string) {
  const user = useAuthStore.getState().auth.user
  return user?.sessionId === session ? skillHubIdSchema.safeParse(user.userId).data : undefined
}

function readIntent(key: string) {
  try { return skillHubIdSchema.safeParse(localStorage.getItem(key)).data ?? memory.get(key) }
  catch { return memory.get(key) }
}
function setIntent(key: string, value: string | undefined) {
  memory.delete(key)
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key) }
  catch { if (value) memory.set(key, value) }
  intentRevision++
  for (const listener of listeners) listener()
}

function clearIntent(key: string, requestId: string) {
  if (readIntent(key) === requestId) setIntent(key, undefined)
}

export function listHubIntents(session: string) {
  const accountId = accountForSession(session)
  if (!accountId) return []
  const prefix = `${intentRoot}${accountId}:`
  const keys = new Set(memory.keys())
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key) keys.add(key) } }
  catch { /* localStorage is optional */ }
  return [...keys].flatMap((key) => {
    if (!key.startsWith(prefix)) return []
    const [action] = key.slice(prefix.length).split(":")
    const parsed = skillHubReceiptInputSchema.safeParse({ action, requestId: readIntent(key) })
    return parsed.success ? [{ key, request: parsed.data }] : []
  })
}

export function checkHubIntent(session: string, item: ReturnType<typeof listHubIntents>[number]) {
  if (!listHubIntents(session).some((candidate) => candidate.key === item.key && candidate.request.requestId === item.request.requestId)) {
    return Promise.resolve({ state: "unknown", request: item.request } as const)
  }
  return readHubReceipt(session, item.request, { clear: () => clearIntent(item.key, item.request.requestId), remember() { return undefined } })
}

export function useSkillPublish({ session, action, target, onCommitted }: {
  session: string; action: SkillHubWriteAction; target: string; onCommitted: (outcome?: WriteOutcome) => void
}) {
  const cache = useQueryClient()
  const accountId = accountForSession(session)
  const key = accountId ? intentKey(accountId, action, target) : ""
  const [pendingId, setPendingId] = useState(() => readIntent(key))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [canRetry, setCanRetry] = useState(false)
  const working = useRef(false)
  const writeId = useRef<string>(pendingId ?? '')
  const originalSend = useRef<{ requestId: string; send: Send } | null>(null)
  const tracker = (requestId: string): Tracker => ({
    remember(request) { setIntent(key, request.requestId); setPendingId(request.requestId) },
    clear() { clearIntent(key, requestId); setPendingId(readIntent(key)) },
  })

  function apply(result: Result) {
    if (result.state === 'unknown') {
      setError('尚未确认写入结果。请查询原请求回执。')
      setCanRetry(originalSend.current?.requestId === result.request.requestId)
      return
    }
    if (result.state === 'rejected') {
      setError(result.error.message)
      setConflict(['HUB_VERSION_CONFLICT', 'HUB_REVISION_CONFLICT'].includes(result.error.code ?? ''))
      originalSend.current = null
      return
    }
    assertHubSession(session)
    void cache.invalidateQueries({ queryKey: hubScope(session) })
    onCommitted(result.outcome)
  }

  async function work(job: () => Promise<Result>) {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    setConflict(false)
    setCanRetry(false)
    try {
      assertHubSession(session)
      apply(await job())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作未完成，请检查输入后重试。')
    } finally { working.current = false; setBusy(false) }
  }

  function check() {
    const requestId = readIntent(key)
    if (!requestId) return
    setPendingId(requestId)
    return work(() => readHubReceipt(session, { action, requestId }, tracker(requestId)))
  }

  function submit(prepare: () => Promise<Send>) {
    if (!accountId) { setError("无法确认当前账号，请刷新页面。"); return }
    if (readIntent(key)) return check()
    writeId.current ||= crypto.randomUUID()
    return work(async () => {
      const send = await prepare()
      assertHubSession(session)
      const existing = readIntent(key)
      if (existing) {
        setPendingId(existing)
        return readHubReceipt(session, { action, requestId: existing }, tracker(existing))
      }
      const requestId = writeId.current
      originalSend.current = { requestId, send }
      return submitHubWrite(session, { action, requestId }, () => send(requestId), tracker(requestId))
    })
  }

  function retryOriginal() {
    const requestId = readIntent(key), attempt = originalSend.current
    if (!requestId || attempt?.requestId !== requestId) return
    return work(() => submitHubWrite(session, { action, requestId }, () => attempt.send(requestId), tracker(requestId), true))
  }

  return { busy, pendingId, error, setError, conflict, setConflict, submit, check, retryOriginal, canRetry }
}

export type SkillPublishModel = ReturnType<typeof useSkillPublish>

export function useHubUploadStage(session: string) {
  const keys = useRef(new WeakMap<Blob, Map<string, string>>())
  return async (file: Blob, teamId: string, purpose: 'package' | 'icon', format?: 'markdown' | 'zip') => {
    let byTeam = keys.current.get(file)
    if (!byTeam) { byTeam = new Map(); keys.current.set(file, byTeam) }
    const mapKey = `${teamId}:${purpose}:${format ?? ''}`
    let requestId = byTeam.get(mapKey)
    if (!requestId) { requestId = crypto.randomUUID(); byTeam.set(mapKey, requestId) }
    const upload = (id: string) => skillHubApi.upload(session, purpose === 'package' && format
      ? { purpose, format, teamId, requestId: id }
      : { purpose: 'icon', teamId, requestId: id }, file)
    try { return await upload(requestId) }
    catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'HUB_UPLOAD_EXPIRED') throw error
      const next = crypto.randomUUID()
      byTeam.set(mapKey, next)
      return upload(next)
    }
  }
}
