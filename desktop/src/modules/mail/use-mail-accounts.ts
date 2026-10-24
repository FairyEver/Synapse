import { useEffect, useRef, useState } from "react"
import type { ZodType } from "zod"
import type { AccountSummary, AccountConfig, Folder } from "../../../app-capabilities/mail/shared/types"
import type { ConfigureAccount } from "../../../app-capabilities/mail/shared/private-schema"
import { configureAccountSchema } from "../../../app-capabilities/mail/shared/private-schema"
import { MAIL_INPUT_SCHEMAS } from "../../../app-capabilities/mail/shared/schema"
import { runMailUiOperation } from "../../../app-capabilities/mail/renderer/tracking"
import { mailApi, mailError } from "./api"
function parseAccountFields<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0], field = issue?.path.filter(part => typeof part === "string").join(".")
  const messages: Record<string, string> = {
    email: "邮箱地址格式无效", name: "显示名称须为 1–100 个字符，且不能包含换行",
    aliases: issue?.code === "too_big" ? "其他邮箱地址最多 30 个，每个地址最长 320 个字符" : "其他邮箱地址格式无效，多个地址用逗号或分号分隔",
    "imap.host": "IMAP 服务器地址无效", "smtp.host": "SMTP 服务器地址无效",
    "imap.port": "IMAP 端口须为 1–65535 的整数", "smtp.port": "SMTP 端口须为 1–65535 的整数",
    "imap.security": "请选择 IMAP 加密方式", "smtp.security": "请选择 SMTP 加密方式",
    username: "IMAP 用户名无效", smtpUsername: "SMTP 用户名无效", credential: "请输入有效的密码或应用专用密码",
  }
  throw new Error(messages[field ?? ""] ?? "邮箱配置无效，请检查输入")
}
const initial = (): ConfigureAccount => ({ provider: "aliyun", name: "", email: "", credential: "", imap: { host: "imap.qiye.aliyun.com", port: 993, security: "tls" }, smtp: { host: "smtp.qiye.aliyun.com", port: 465, security: "tls" }, sentPolicy: "server", aliases: [], notify: true })
export function useMailAccounts(owner: string | null, onSaved: () => void | Promise<void>) {
  const [dialogOpen, setDialogOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [form, setForm] = useState<ConfigureAccount>(initial)
  const formRef = useRef(form), [step, setStep] = useState<"provider" | "details">("provider"), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const lock = useRef(false), epoch = useRef(0), ownerRef = useRef(owner); ownerRef.current = owner
  useEffect(() => { epoch.current++; setDialogOpen(false); setSettingsOpen(false); formRef.current = initial(); setForm(formRef.current); setError(null); setBusy(false); lock.current = false }, [owner])
  const clearError = () => setError(null)
  const change = (patch: Partial<ConfigureAccount>) => { if (lock.current) return; formRef.current = { ...formRef.current, ...patch }; setForm(formRef.current); clearError() }
  const begin = (account?: AccountSummary) => {
    if (lock.current) return
    const next = account ? { ...initial(), ...account, accountId: account.id, expectedRevision: account.revision, credential: "" } : initial()
    // Keep only configuration fields, never summary state in the private configure schema.
    const { provider, name, email, username, smtpUsername, imap, smtp, sentPolicy, aliases, notify, credential, accountId, expectedRevision } = next
    formRef.current = { provider, name, email, username, smtpUsername, imap, smtp, sentPolicy, aliases, notify, credential, accountId, expectedRevision }
    setForm(formRef.current); setStep(account ? "details" : "provider"); setError(null); setDialogOpen(true); setSettingsOpen(false)
  }
  const close = () => { if (lock.current) return; change({ credential: "" }); setDialogOpen(false) }
  const run = async <T,>(task: () => Promise<T>): Promise<T | null> => {
    if (lock.current) return null
    lock.current = true; const e = epoch.current; setBusy(true); setError(null)
    try { const result = await task(); if (e === epoch.current) await onSaved(); return e === epoch.current ? result : null }
    catch (cause) { if (e === epoch.current) setError(mailError(cause)); return null }
    finally { if (e === epoch.current) { lock.current = false; setBusy(false) } }
  }
  const connect = async () => {
    const current = formRef.current, identity = ownerRef.current
    formRef.current = { ...current, credential: "" }; setForm(formRef.current)
    const result = await run(async () => {
      const parsed = parseAccountFields(configureAccountSchema, { ...current, name: current.name.trim() || current.email })
      return runMailUiOperation("configure", () => mailApi().accountConfigure(parsed))
    })
    if (identity === ownerRef.current) { formRef.current = { ...formRef.current, credential: "" }; setForm(formRef.current); if (result) setDialogOpen(false) }
  }
  const update = (account: AccountSummary, patch: Partial<AccountConfig>) => run(() => mailApi().accountUpdate({ accountId: account.id, expectedRevision: account.revision, patch: parseAccountFields(MAIL_INPUT_SCHEMAS["account.update"].shape.patch, patch) }))
  const pause = (account: AccountSummary) => run(async () => account.paused ? mailApi().accountResume({ accountId: account.id }) : mailApi().accountPause({ accountId: account.id }))
  const inspect = (id: string) => run(async () => { const checks = await mailApi().accountInspect({ accountId: id }); if (!checks.imap.ok || !checks.smtp.ok) throw new Error(`连接检查失败：${checks.imap.code ?? checks.smtp.code}`); return checks })
  const clear = (id: string) => run(() => mailApi().cacheClear({ accountId: id }))
  const remove = (account: AccountSummary, discardLocalDrafts: boolean, acknowledgeUnknownOperations: boolean) => run(() => mailApi().accountDelete({ accountId: account.id, expectedRevision: account.revision, discardLocalDrafts, acknowledgeUnknownOperations }))
  const mapFolder = (account: AccountSummary, folderId: string, role: Folder["role"]) => run(() => mailApi().folderUpdate({ accountId: account.id, expectedAccountRevision: account.revision, folderId, role }))
  const folder = (accountId: string, operation: "create" | "rename" | "delete", folderId?: string, name?: string) => run(async () => operation === "create" ? mailApi().folderCreate({ accountId, name: name! }) : operation === "rename" ? mailApi().folderRename({ accountId, folderId: folderId!, name: name! }) : mailApi().folderDelete({ accountId, folderId: folderId! }))
  return { dialogOpen, settingsOpen, setSettingsOpen, form, step, setStep, busy, error, clearError, change, begin, close, connect, update, pause, inspect, clear, remove, mapFolder, folder }
}
export type MailAccountsModel = ReturnType<typeof useMailAccounts>
