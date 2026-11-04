import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  SkillHubDeleteResult, SkillHubReceiptInput, SkillHubReceiptResult, SkillHubWriteAction, SkillHubWriteReplay, SkillHubWriteResult,
} from '@synapse/shared/skill-hub-contracts'
import { skillHubIdSchema, skillHubReceiptInputSchema } from '@synapse/shared/skill-hub-contracts'
import { ApiError } from '@/lib/api-client'
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
  return () => { listeners.delete(listener) }
}
export const getHubIntentRevision = () => intentRevision
const intentKey = (session: string, action: SkillHubWriteAction, target: string) => `synapse.hub.write:${session}:${action}:${target}`
function readIntent(key: string) {
  try { return skillHubIdSchema.safeParse(sessionStorage.getItem(key) ?? memory.get(key)).data }
  catch { return memory.get(key) }
}
function setIntent(key: string, value: string | undefined) {
  if (value) memory.set(key, value)
  else memory.delete(key)
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key) }
  catch { /* Keep the in-memory entry if storage is disabled. */ }
  intentRevision++
  for (const listener of listeners) listener()
}

export function listHubIntents(session: string) {
  if (!session) return []
  const prefix = `synapse.hub.write:${session}:`
  const keys = new Set(memory.keys())
  try { for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i); if (key) keys.add(key) } }
  catch { /* sessionStorage is optional */ }
  return [...keys].flatMap((key) => {
    if (!key.startsWith(prefix)) return []
    const [action] = key.slice(prefix.length).split(":")
    const parsed = skillHubReceiptInputSchema.safeParse({ action, requestId: readIntent(key) })
    return parsed.success ? [{ key, request: parsed.data }] : []
  })
}

export function checkHubIntent(session: string, item: ReturnType<typeof listHubIntents>[number]) {
  return readHubReceipt(session, item.request, { clear: () => setIntent(item.key, undefined), remember() { return undefined } })
}

export function useSkillPublish({ session, action, target, onCommitted }: {
  session: string; action: SkillHubWriteAction; target: string; onCommitted: (outcome?: WriteOutcome) => void
}) {
  const cache = useQueryClient()
  const key = intentKey(session, action, target)
  const [pendingId, setPendingId] = useState(() => readIntent(key))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [canRetry, setCanRetry] = useState(false)
  const working = useRef(false)
  const writeId = useRef<string>(pendingId ?? '')
  const originalSend = useRef<Send | null>(null)
  const tracker = {
    remember(request: SkillHubReceiptInput) { setIntent(key, request.requestId); setPendingId(request.requestId) },
    clear() { setIntent(key, undefined); setPendingId(undefined) },
  }

  function apply(result: Result) {
    if (result.state === 'unknown') {
      setError('尚未确认写入结果。请查询原请求回执。')
      setCanRetry(Boolean(originalSend.current))
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
    return work(() => readHubReceipt(session, { action, requestId }, tracker))
  }

  function submit(prepare: () => Promise<Send>) {
    if (readIntent(key)) return check()
    writeId.current ||= crypto.randomUUID()
    return work(async () => {
      const send = await prepare()
      assertHubSession(session)
      originalSend.current = send
      const requestId = writeId.current
      return submitHubWrite(session, { action, requestId }, () => send(requestId), tracker)
    })
  }

  function retryOriginal() {
    const requestId = readIntent(key), send = originalSend.current
    if (!requestId || !send) return
    return work(() => submitHubWrite(session, { action, requestId }, () => send(requestId), tracker, true))
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
