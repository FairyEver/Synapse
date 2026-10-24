import { useCallback, useEffect, useRef, useState } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { useAccount } from "@/app-shell/account"
import type { AccountSummary, Folder, MailSummary, MailDetail, Coverage, Draft, BatchResult } from "../../../app-capabilities/mail/shared/types"
import type { MailScope } from "../../../app-capabilities/mail/shared/private-schema"
import { runMailUiOperation } from "../../../app-capabilities/mail/renderer/tracking"
import { mailApi, mailError } from "./api"
import { useMailSync } from "./use-mail-sync"
export type MailView = { folderId?: string; starredOnly?: boolean; drafts?: boolean }
type DraftDeleteResult = { items: { id: string; status: "succeeded" | "failed"; error?: string }[] }
export function useMail() {
  const { state } = useAccount(), owner = state.status === "authenticated" ? state.profile.user.id : null
  const ownerRef = useRef(owner); ownerRef.current = owner
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([]), [accountId, setAccountId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([]), [view, setView] = useState<MailView>({})
  const [items, setItems] = useState<MailSummary[]>([]), [drafts, setDrafts] = useState<Omit<Draft, "html" | "text">[]>([])
  const [detail, setDetail] = useState<MailDetail | null>(null), [coverage, setCoverage] = useState<Coverage | null>(null)
  const [cursor, setCursor] = useState<string | null>(null), [canContinue, setCanContinue] = useState(false)
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null)
  const scope = useRef<MailScope | null>(null), active = useRef(true), epoch = useRef(0), sequence = useRef(0), selection = useRef(0)
  const draftPages = useRef(1)
  const accountRef = useRef<string | null>(null), viewRef = useRef<MailView>({}), searchJob = useRef<string | null>(null), searchSequence = useRef(0), retries = useRef(new Map<string, string>())
  const current = (e: number, id: string | null, identity = owner) => active.current && epoch.current === e && ownerRef.current === identity && accountRef.current === id
  const selectAccount = useCallback((id: string) => {
    if (accountRef.current === id) return
    epoch.current++; sequence.current++; selection.current++; draftPages.current = 1; accountRef.current = id; viewRef.current = {}; searchJob.current = null; retries.current.clear()
    setAccountId(id); setView({}); setItems([]); setDrafts([]); setDetail(null); setFolders([]); setCoverage(null); setCursor(null); setCanContinue(false); setError(null)
  }, [])
  const refresh = useCallback(async (more = false, nextCursor?: string) => {
    const id = accountRef.current
    if (!id || !owner) return
    const e = epoch.current, seq = ++sequence.current, selected = viewRef.current, job = searchJob.current
    setLoading(true)
    const valid = () => current(e, id) && sequence.current === seq
    try {
      if (selected.drafts && !job) {
        const rows: Omit<Draft, "html" | "text">[] = [], limit = more ? 1 : draftPages.current
        let next = nextCursor, pages = 0
        do {
          const page = await mailApi().draftList({ accountId: id, limit: 50, cursor: next })
          if (!valid()) return
          rows.push(...page.items); next = page.nextCursor ?? undefined; pages++
        } while (next && pages < limit)
        if (valid()) { draftPages.current = more ? draftPages.current + pages : pages; setDrafts(previous => more ? [...previous, ...rows] : rows); setCursor(next ?? null); setError(null) }
      } else {
        const page = job ? await mailApi().searchGet({ jobId: job, cursor: nextCursor, limit: 50 }) : await mailApi().messageList({ accountId: id, folderId: selected.folderId, starredOnly: selected.starredOnly, cursor: nextCursor, limit: 50 })
        if (valid()) { setItems(previous => more ? [...new Map([...previous, ...page.items].map(item => [item.id, item])).values()] : page.items); setCursor(page.nextCursor); setCoverage(page.coverage); setCanContinue("canContinue" in page && page.canContinue === true); setError(null) }
      }
    } catch (cause) { if (valid()) setError(mailError(cause)) }
    finally { if (valid()) setLoading(false) }
  }, [owner])
  const refreshRef = useRef(refresh); refreshRef.current = refresh
  const loadFolders = useCallback(async () => {
    const id = accountRef.current, identity = owner
    if (!id || !identity) return
    const all: Folder[] = []; let next: string | undefined
    do { const page = await mailApi().folderList({ accountId: id, cursor: next, limit: 100 }); all.push(...page.items); next = page.nextCursor ?? undefined } while (next && active.current && accountRef.current === id && ownerRef.current === identity)
    if (active.current && accountRef.current === id && ownerRef.current === identity) setFolders(all)
  }, [owner])
  const loadAccounts = useCallback(async () => {
    const identity = owner
    if (!identity) return
    try {
      const api = mailApi(), nextScope = await api.uiScope(), result: AccountSummary[] = []
      if (nextScope.ownerId !== identity) return
      const resetGeneration = scope.current !== null && scope.current.generation !== nextScope.generation
      if (resetGeneration) { epoch.current++; sequence.current++; selection.current++; draftPages.current = 1; retries.current.clear(); searchJob.current = null; setItems([]); setDrafts([]); setDetail(null); setCoverage(null); setCursor(null); setCanContinue(false) }
      let next: string | undefined
      do { const page = await api.accountList({ limit: 100, cursor: next }); result.push(...page.items); next = page.nextCursor ?? undefined } while (next && ownerRef.current === identity)
      if (!active.current || ownerRef.current !== identity) return
      scope.current = nextScope; setAccounts(result); setLoadedOwner(identity)
      if (!result.some(a => a.id === accountRef.current)) {
        if (result[0]) selectAccount(result[0].id)
        else { accountRef.current = null; setAccountId(null); setItems([]); setDetail(null); setFolders([]) }
      }
      await loadFolders()
      if (resetGeneration) void refreshRef.current()
    } catch (cause) { if (active.current && ownerRef.current === identity) setError(mailError(cause)) }
  }, [owner, selectAccount, loadFolders])
  useEffect(() => {
    active.current = true; epoch.current++; draftPages.current = 1; accountRef.current = null; setAccountId(null); setAccounts([]); setLoadedOwner(null); setItems([]); setDetail(null); setFolders([]); setDrafts([])
    scope.current = null
    if (owner) void loadAccounts()
    return () => { active.current = false; epoch.current++; sequence.current++; selection.current++ }
  }, [owner, loadAccounts])
  useEffect(() => {
    if (!accountId) return
    void refreshRef.current()
  }, [accountId, owner])
  useEffect(() => {
    if (!owner) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const offIdentity = getSynapseBridge()?.account.state.onChanged(() => { void loadAccounts() })
    const off = mailApi().onChanged(event => {
      if (event.ownerId !== ownerRef.current || event.generation !== scope.current?.generation) return
      clearTimeout(timer)
      timer = setTimeout(() => { void loadAccounts(); if (event.accountId === accountRef.current) void refreshRef.current() }, 120)
    })
    const focus = () => { void loadAccounts(); void refreshRef.current() }
    window.addEventListener("focus", focus)
    return () => { off(); offIdentity?.(); clearTimeout(timer); window.removeEventListener("focus", focus) }
  }, [owner, loadAccounts])
  const selectView = useCallback((next: MailView) => {
    epoch.current++; sequence.current++; selection.current++; draftPages.current = 1; viewRef.current = next; searchJob.current = null
    setView(next); setItems([]); setDrafts([]); setDetail(null); setCoverage(null); setCursor(null); setCanContinue(false); void refreshRef.current()
  }, [])
  const selectMessage = useCallback(async (id: string) => {
    const account = accountRef.current, e = epoch.current, seq = ++selection.current
    setDetail(null)
    const valid = () => current(e, account) && seq === selection.current
    try {
      const message = await runMailUiOperation("select", () => mailApi().messageGet({ messageId: id }))
      if (!valid() || message.accountId !== account) return
      setDetail(message)
      if (!message.read) {
        const result = await mailApi().messageUpdate({ accountId: account!, messageIds: [id], patch: { read: true } })
        if (valid()) {
          if (result.items[0]?.status !== "succeeded") throw new Error("标记已读未确认，请重试")
          setDetail({ ...message, read: true, revision: result.items[0].newRevision ?? message.revision }); setItems(rows => rows.map(row => row.id === id ? { ...row, read: true } : row))
        }
      }
    } catch (cause) { if (valid()) setError(mailError(cause)) }
  }, [owner])
  const search = useCallback(async (query: string, fields: "metadata" | "body" = "metadata") => {
    const id = accountRef.current; if (!id) return
    const querySequence = ++searchSequence.current
    if (!query.trim()) { searchJob.current = null; setCanContinue(false); await refreshRef.current(); return }
    const e = epoch.current; selection.current++; setDetail(null)
    try {
      const job = await mailApi().searchStart({ accountId: id, folderId: viewRef.current.folderId, query, fields })
      if (!current(e, id) || querySequence !== searchSequence.current) return
      searchJob.current = job.jobId; await refreshRef.current()
    } catch (cause) { if (current(e, id)) setError(mailError(cause)) }
  }, [owner])
  const continueSearch = useCallback(async () => { if (!searchJob.current) return; await mailApi().searchResume({ jobId: searchJob.current }); await refreshRef.current() }, [])
  const mutate = useCallback(async (action: "delete" | "restore" | "move" | "read" | "unread" | "star" | "unstar" | "permanent", ids: string[], targetFolderId?: string): Promise<BatchResult> => {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("每次请选择 1–100 封不同邮件")
    const id = accountRef.current; if (!id) throw new Error("请选择邮箱")
    const e = epoch.current, key = JSON.stringify([id, action, ids, targetFolderId])
    const clientRequestId = retries.current.get(key) ?? crypto.randomUUID(); retries.current.set(key, clientRequestId)
    const base = { accountId: id, messageIds: ids, clientRequestId }, api = mailApi()
    const result = action === "restore" ? await api.messageRestore({ ...base, targetFolderId }) : action === "move" ? await api.messageMove({ ...base, targetFolderId: targetFolderId! }) : action === "delete" || action === "permanent" ? await api.messageDelete({ ...base, permanent: action === "permanent" }) : await api.messageUpdate({ accountId: id, messageIds: ids, patch: action === "read" || action === "unread" ? { read: action === "read" } : { star: action === "star" } })
    if (!current(e, id)) throw new Error("邮箱账号已变化")
    if (result.items.every(item => item.status !== "unknown")) retries.current.delete(key)
    if (detail && ids.includes(detail.id) && ["delete", "move", "restore", "permanent"].includes(action)) setDetail(null)
    await refreshRef.current(); return result
  }, [owner, detail])
  const clearDetail = useCallback(() => { selection.current++; setDetail(null) }, [])
  const deleteDrafts = useCallback(async (ids: string[], onRemainingChange?: (remaining: number) => void): Promise<DraftDeleteResult> => {
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("每次请选择 1–100 封不同草稿")
    const id = accountRef.current, e = epoch.current
    if (!id || !owner) throw new Error("请选择邮箱")
    const selected = ids.map(draftId => {
      const draft = drafts.find(item => item.id === draftId && item.accountId === id)
      if (!draft) throw new Error("草稿列表已变化，请重新选择")
      return draft
    })
    const result: DraftDeleteResult = { items: [] }
    for (const draft of selected) {
      if (!current(e, id)) throw new Error("邮箱账号已变化")
      try {
        const response = await mailApi().draftDelete({ draftId: draft.id, expectedRevision: draft.revision })
        if (!response.success) throw new Error("删除草稿失败，请重试")
        result.items.push({ id: draft.id, status: "succeeded" })
      } catch (cause) { result.items.push({ id: draft.id, status: "failed", error: mailError(cause) }) }
      if (!current(e, id)) throw new Error("邮箱账号已变化")
      onRemainingChange?.(selected.length - result.items.length)
    }
    const deleted = new Set(result.items.filter(item => item.status === "succeeded").map(item => item.id))
    setDrafts(rows => rows.filter(draft => !deleted.has(draft.id)))
    await refreshRef.current()
    if (!current(e, id)) throw new Error("邮箱账号已变化")
    return result
  }, [owner, drafts])
  const sync = useCallback(async () => { if (accountRef.current) { await mailApi().syncStart({ accountId: accountRef.current, folderId: viewRef.current.folderId }); await refreshRef.current() } }, [])
  const visible = loadedOwner === owner
  const syncStatus = useMailSync(visible ? owner : null, visible ? accounts.find(account => account.id === accountId) : undefined, scope.current?.generation)
  return { accounts: visible ? accounts : [], accountId: visible ? accountId : null, folders: visible ? folders : [], items: visible ? items : [], drafts: visible ? drafts : [], detail: visible ? detail : null, view, coverage, cursor, canContinue, loading, error, authenticated: !!owner, scope: scope.current, owner,
    syncStatus, selectAccount, selectView, selectMessage, clearDetail, refresh, loadAccounts, loadMore: () => refresh(true, cursor ?? undefined), search, continueSearch, mutate, deleteDrafts, sync }
}
export type MailViewModel = ReturnType<typeof useMail>
