import { useEffect, useState } from "react"
import type { AccountSummary, MailJob, MailResults } from "../../../app-capabilities/mail/shared/types"
import { mailApi, mailError } from "./api"

type Counts = MailResults["message.count"]
interface Snapshot { key: string; job: MailJob | null; counts: Counts | null; error: string | null }
export interface MailSyncStatus {
  state: MailJob["state"] | null
  label: string
  count: string | null
  progress: string | null
  error: string | null
}
const labels: Record<MailJob["state"], string> = { running: "同步中", paused: "同步已暂停", completed: "同步已完成", cancelled: "历史同步已取消", failed: "同步失败" }
function syncError(code: string | null | undefined): string | null {
  if (!code) return null
  if (code === "AUTH_FAILED") return "邮箱认证失败，请检查密码或客户端授权码"
  if (code === "NETWORK_TIMEOUT") return "邮箱连接超时，等待重试"
  if (code === "NETWORK_ERROR") return "邮箱连接失败，等待重试"
  return "邮箱同步失败，请重试"
}
export function useMailSync(owner: string | null, account: AccountSummary | undefined, generation: number | undefined): MailSyncStatus | null {
  const accountId = account?.id
  const key = JSON.stringify([owner, generation, accountId])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    if (!owner || !accountId || generation === undefined) return
    let disposed = false, loading = false, pending = false, eventScheduled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const api = mailApi()
    const load = async () => {
      if (disposed) return
      if (loading) { pending = true; return }
      clearTimeout(timer); loading = true; pending = false; eventScheduled = false
      try {
        const [job, counts] = await Promise.all([api.syncGet({ accountId }), api.messageCount({ accountId })])
        if (!disposed) setSnapshot({ key, job, counts, error: null })
      } catch (cause) {
        if (!disposed) setSnapshot(previous => ({ key, job: null, counts: previous?.key === key ? previous.counts : null, error: mailError(cause) }))
      } finally {
        loading = false
        if (!disposed) {
          eventScheduled = pending
          timer = setTimeout(() => { void load() }, pending ? 120 : 2000)
        }
      }
    }
    const off = api.onChanged(event => {
      if (event.ownerId !== owner || event.generation !== generation || event.accountId !== accountId) return
      if (loading) { pending = true; return }
      if (eventScheduled) return
      eventScheduled = true
      clearTimeout(timer); timer = setTimeout(() => { void load() }, 120)
    })
    void load()
    return () => { disposed = true; clearTimeout(timer); off() }
  }, [owner, accountId, generation, key])
  if (!owner || !account) return null
  const current = snapshot?.key === key ? snapshot : null
  const counts = current?.counts
  const count = counts ? counts.serverReported === null ? `${counts.indexed}` : `${counts.indexed}/${counts.serverReported}` : null
  const progress = counts ? counts.serverReported === null ? `已索引 ${counts.indexed} 封` : `已索引 ${counts.indexed} / ${counts.serverReported} 封` : null
  const base = { count, progress, error: null }
  if (account.paused || account.state === "paused") return { ...base, state: "paused", label: labels.paused }
  if (account.state === "auth_failed") return { ...base, state: "failed", label: labels.failed, error: syncError("AUTH_FAILED") }
  if (current?.error) return { ...base, state: "failed", label: "同步状态不可用", error: current.error }
  if (!current) return { ...base, state: null, label: "正在读取同步状态" }
  if (current.job) return { ...base, state: current.job.state, label: labels[current.job.state], error: syncError(current.job.errorCode) }
  if (account.state === "offline" || account.state === "error") return { ...base, state: "failed", label: labels.failed, error: syncError(account.errorCode) }
  if (account.state === "unverified") return { ...base, state: null, label: "等待连接验证" }
  return counts?.coverage.metadataComplete ? { ...base, state: "completed", label: labels.completed } : { ...base, state: null, label: "等待同步" }
}
