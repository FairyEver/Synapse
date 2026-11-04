import { useRef, useState } from 'react'
import type { SkillHubAdminRow, SkillHubRevisionInput } from '@synapse/shared/skill-hub-contracts'
import { adminApi } from '@/lib/api'
import { ApiError } from '@/lib/api-client'
import { useAdminAuthStore } from '@/stores/admin-auth-store'

const pageSize = 100

async function findCurrentAsset(teamId: string, id: string) {
  const signal = AbortSignal.timeout(30_000)
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    if (cursor) {
      if (seen.has(cursor)) break
      seen.add(cursor)
    }
    const page = await adminApi.listTeamSkills(teamId, { limit: pageSize, cursor }, signal)
    const item = page.items.find((asset) => asset.id === id)
    if (item) return item
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  throw new Error('该 Skill 已不可用。')
}

export function useTeamSkillWrite(row: SkillHubAdminRow, onSuccess: (row: SkillHubAdminRow) => void) {
  const session = useAdminAuthStore((state) => state.auth.session?.sessionId)
  const [baseline, setBaseline] = useState(row)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const pending = useRef<{ input: SkillHubRevisionInput; send: (input: SkillHubRevisionInput) => Promise<SkillHubAdminRow> } | null>(null)
  const working = useRef(false)

  async function run(send?: (input: SkillHubRevisionInput) => Promise<SkillHubAdminRow>) {
    if (working.current || conflict) return
    if (!pending.current && send) pending.current = { input: { expectedRevision: baseline.revision, requestId: crypto.randomUUID() }, send }
    const write = pending.current
    if (!write) return
    working.current = true
    setBusy(true); setError('')
    try {
      if (useAdminAuthStore.getState().auth.session?.sessionId !== session) return
      const result = await write.send(write.input)
      if (useAdminAuthStore.getState().auth.session?.sessionId !== session) return
      pending.current = null
      setUnknown(false)
      onSuccess(result)
    } catch (err) {
      const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408
        && !(unknown && (err.status === 401 || err.status === 403))
      if (rejected) {
        pending.current = null
        setUnknown(false)
        setConflict(err.code === 'HUB_REVISION_CONFLICT')
        setError(err.message)
      } else {
        setUnknown(true)
        setError('结果尚未确认。可重试原请求。')
      }
    } finally { working.current = false; setBusy(false) }
  }

  async function reload() {
    if (working.current || unknown) return
    working.current = true
    setBusy(true)
    try {
      const fresh = await findCurrentAsset(baseline.team.id, baseline.id)
      if (useAdminAuthStore.getState().auth.session?.sessionId !== session) return
      setBaseline(fresh)
      setConflict(false)
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : '无法读取当前资料。') }
    finally { working.current = false; setBusy(false) }
  }

  return { baseline, busy, error, conflict, unknown, run, reload }
}
