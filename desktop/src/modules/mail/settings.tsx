import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogFrame, DialogFrameHeader, DialogFrameBody, DialogFrameFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { MailViewModel } from "./use-mail"
import type { MailAccountsModel } from "./use-mail-accounts"
import type { Folder } from "../../../app-capabilities/mail/shared/types"
import { folderName } from "./navigation"
const roles: { role: Folder["role"]; label: string }[] = [{ role: "inbox", label: "收件箱" }, { role: "sent", label: "已发送" }, { role: "drafts", label: "草稿箱" }, { role: "trash", label: "回收站" }, { role: "junk", label: "垃圾邮件" }]
const states = { connected: "已连接", unverified: "需要检查连接", connecting: "连接中", offline: "离线", auth_failed: "认证失败", error: "连接错误", paused: "已暂停" }
export function MailSettings({ model, mail }: { model: MailAccountsModel; mail: MailViewModel }) {
  const account = mail.accounts.find(item => item.id === mail.accountId)
  const [name, setName] = useState(""), [aliases, setAliases] = useState(""), [removing, setRemoving] = useState(false), [discard, setDiscard] = useState(false), [ack, setAck] = useState(false)
  const [folderId, setFolderId] = useState(""), [folderLabel, setFolderLabel] = useState("")
  useEffect(() => { setName(account?.name ?? ""); setAliases(account?.aliases.join(", ") ?? ""); setRemoving(false); setDiscard(false); setAck(false) }, [account?.id, account?.revision])
  const saveName = () => { if (account) void model.update(account, { name, aliases: aliases.split(/[,;\n]/u).map(a => a.trim()).filter(Boolean) }) }
  const map = (role: Folder["role"], id: string) => {
    if (!account) return
    const previous = mail.folders.find(folder => folder.role === role)
    if (id) void model.mapFolder(account, id, role)
    else if (previous) void model.mapFolder(account, previous.id, "none")
  }
  const remove = async () => { if (!account) return; const result = await model.remove(account, discard, ack); if (result) setRemoving(false) }
  const clear = async () => { if (!account) return; const result = await model.clear(account.id); if (result) toast(`已清理 ${result.removed} 项缓存`) }
  const inspect = async () => { if (!account) return; const result = await model.inspect(account.id); if (result) toast("IMAP 和 SMTP 连接正常") }
  const selectedFolder = mail.folders.find(folder => folder.id === folderId)
  return <><Dialog open={model.settingsOpen} onOpenChange={open => { if (!model.busy) model.setSettingsOpen(open) }}><DialogContent className="h-4/5 max-w-2xl p-0" showCloseButton={false} aria-describedby={undefined}><DialogFrame><DialogFrameHeader title="邮箱设置" bordered actions={<Button onClick={() => model.begin()} disabled={model.busy}>添加邮箱</Button>} /><DialogFrameBody className="space-y-6 overflow-auto p-5">
    <NativeSelect aria-label="设置的邮箱" className="w-full" value={mail.accountId ?? ""} onChange={event => { model.clearError(); mail.selectAccount(event.target.value) }}>{!mail.accounts.length && <NativeSelectOption value="">尚未添加邮箱</NativeSelectOption>}{mail.accounts.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect>
    {account && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm">{account.email}</p><p className="text-xs text-muted-foreground">{states[account.state]}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={model.busy} onClick={() => void inspect()}>检查连接</Button><Button variant="outline" disabled={model.busy} onClick={() => model.begin(account)}>重新连接</Button><Button variant="outline" disabled={model.busy} onClick={() => void model.pause(account)}>{account.paused ? "恢复收信" : "暂停收信"}</Button></div></div>
      <div className="grid gap-3"><div className="space-y-1"><Label htmlFor="mail-settings-name">显示名称</Label><Input id="mail-settings-name" value={name} disabled={model.busy} onChange={event => { setName(event.target.value); model.clearError() }} /></div><div className="space-y-1"><Label htmlFor="mail-settings-aliases">自己的其他邮箱地址（回复全部时排除）</Label><Input id="mail-settings-aliases" value={aliases} disabled={model.busy} onChange={event => { setAliases(event.target.value); model.clearError() }} /></div><Button variant="outline" className="justify-self-start" onClick={saveName} disabled={model.busy || !name.trim()}>保存名称与地址</Button></div>
      <div className="flex items-center justify-between gap-3"><Label htmlFor="mail-settings-notify">新邮件提醒</Label><Switch id="mail-settings-notify" checked={account.notify} disabled={model.busy} onCheckedChange={notify => void model.update(account, { notify })} /></div>
      {mail.scope && (!mail.scope.notificationsSupported || mail.scope.notificationError) && <p role="status" className="text-sm text-muted-foreground">{mail.scope.notificationError ? "系统通知未成功显示，请检查系统设置" : "当前系统不支持邮件通知"}</p>}
      <fieldset className="space-y-3" disabled={model.busy}><legend className="mb-2 text-sm font-medium">系统文件夹</legend>{roles.map(({ role, label }) => <div key={role} className="grid grid-cols-[6rem_1fr] items-center gap-3"><Label htmlFor={`mail-role-${role}`}>{label}</Label><NativeSelect id={`mail-role-${role}`} className="w-full" value={mail.folders.find(folder => folder.role === role)?.id ?? ""} onChange={event => map(role, event.target.value)}><NativeSelectOption value="">未指定</NativeSelectOption>{mail.folders.filter(folder => folder.selectable).map(folder => <NativeSelectOption key={folder.id} value={folder.id}>{folder.path}</NativeSelectOption>)}</NativeSelect></div>)}</fieldset>
      <fieldset className="space-y-3" disabled={model.busy}><legend className="mb-2 text-sm font-medium">普通文件夹</legend><NativeSelect aria-label="管理文件夹" className="w-full" value={folderId} onChange={event => { setFolderId(event.target.value); setFolderLabel(mail.folders.find(folder => folder.id === event.target.value)?.name ?? "") }}><NativeSelectOption value="">新建文件夹</NativeSelectOption>{mail.folders.filter(folder => folder.role === "none" && folder.selectable).map(folder => <NativeSelectOption value={folder.id} key={folder.id}>{folderName(folder)}</NativeSelectOption>)}</NativeSelect><div className="space-y-1"><Label htmlFor="mail-settings-folder-name">文件夹名称</Label><Input id="mail-settings-folder-name" value={folderLabel} onChange={event => setFolderLabel(event.target.value)} /></div><div className="flex gap-2"><Button variant="outline" disabled={model.busy || !folderLabel.trim()} onClick={() => void model.folder(account.id, folderId ? "rename" : "create", folderId || undefined, folderLabel)}>{folderId ? "重命名" : "新建文件夹"}</Button>{folderId && <Button variant="destructive" disabled={model.busy || selectedFolder?.serverCount !== 0} onClick={() => void model.folder(account.id, "delete", folderId)}>删除空文件夹</Button>}</div></fieldset>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={model.busy} onClick={() => void clear()}>清理下载缓存</Button><Button variant="destructive" disabled={model.busy} onClick={() => setRemoving(true)}>从本机移除</Button></div>
    </>}
  </DialogFrameBody><DialogFrameFooter>{model.error && <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">{model.error}</p>}<Button variant="outline" disabled={model.busy} onClick={() => model.setSettingsOpen(false)}>关闭</Button></DialogFrameFooter></DialogFrame></DialogContent></Dialog>
  <AlertDialog data-track="mail.account.remove" open={removing} onOpenChange={open => { if (!model.busy) setRemoving(open) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>从本机移除 {account?.name}？</AlertDialogTitle><AlertDialogDescription>清除此电脑的账号、密码和缓存，服务器邮件保留。</AlertDialogDescription></AlertDialogHeader><div className="space-y-3"><Label className="flex items-center gap-2"><Checkbox checked={discard} onCheckedChange={value => setDiscard(value === true)} disabled={model.busy} />丢弃此账号的本机未发送草稿</Label><Label className="flex items-center gap-2"><Checkbox checked={ack} onCheckedChange={value => setAck(value === true)} disabled={model.busy} />已核对发送或整理结果未确认的操作</Label>{model.error && <p role="alert" className="text-sm text-destructive">{model.error}</p>}</div><AlertDialogFooter><AlertDialogCancel disabled={model.busy}>取消</AlertDialogCancel><Button variant="destructive" disabled={model.busy} onClick={() => void remove()}>移除</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>
}
