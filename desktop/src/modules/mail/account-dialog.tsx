import { useEffect, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Dialog, DialogContent, DialogFrame } from "@/components/ui/dialog"
import { GuidedFlow } from "@/components/guided-flow"
import { Field, FieldLabel, FieldTitle, FieldSet, FieldLegend } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { MailAccountsModel } from "./use-mail-accounts"
import type { AccountConfig } from "../../../app-capabilities/mail/shared/types"
const steps = [{ id: "provider", title: "选择邮箱" }, { id: "details", title: "连接账号" }]
function EndpointFields({ kind, value, onChange, disabled }: { kind: "IMAP" | "SMTP"; value: AccountConfig["imap"]; onChange(value: AccountConfig["imap"]): void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="grid grid-cols-2 gap-3"><legend className="mb-2 text-sm font-medium">{kind}</legend><div className="col-span-2 space-y-1"><Label htmlFor={`mail-${kind}-host`}>服务器</Label><Input id={`mail-${kind}-host`} value={value.host} onChange={event => onChange({ ...value, host: event.target.value })} autoComplete="off" /></div><div className="space-y-1"><Label htmlFor={`mail-${kind}-port`}>端口</Label><Input id={`mail-${kind}-port`} type="number" min={1} max={65535} value={value.port} onChange={event => onChange({ ...value, port: Number(event.target.value) })} /></div><div className="space-y-1"><Label htmlFor={`mail-${kind}-security`}>加密</Label><NativeSelect id={`mail-${kind}-security`} className="w-full" value={value.security} onChange={event => onChange({ ...value, security: event.target.value as "tls" | "starttls" })}><NativeSelectOption value="tls">TLS</NativeSelectOption><NativeSelectOption value="starttls">STARTTLS</NativeSelectOption></NativeSelect></div></fieldset>
}
export function MailAccountDialog({ model }: { model: MailAccountsModel }) {
  const [advanced, setAdvanced] = useState(false)
  const [credentialVisible, setCredentialVisible] = useState(false)
  useEffect(() => { if (!model.dialogOpen) setCredentialVisible(false) }, [model.dialogOpen])
  const { form } = model
  const next = () => { if (model.step === "provider") model.setStep("details"); else void model.connect() }
  return <Dialog open={model.dialogOpen} onOpenChange={open => { if (!open) model.close() }}><DialogContent className="h-4/5 max-w-2xl p-0" showCloseButton={false} aria-describedby={undefined}><DialogFrame><GuidedFlow title={form.accountId ? "重新连接邮箱" : "添加邮箱"} step={model.step} steps={steps} busy={model.busy} nextLabel={model.step === "details" ? model.busy ? "连接中…" : "连接" : "下一步"} onBack={model.step === "details" && !form.accountId ? () => model.setStep("provider") : undefined} onNext={next} onCancel={model.close} canNext={model.step === "provider" || !!form.email.trim() && !!form.credential}>
    {model.step === "provider" ? <FieldSet><FieldLegend>邮箱类型</FieldLegend><RadioGroup value={form.provider} onValueChange={provider => { model.change({ provider: provider as "aliyun" | "custom", ...(provider === "aliyun" ? { imap: { host: "imap.qiye.aliyun.com", port: 993, security: "tls" }, smtp: { host: "smtp.qiye.aliyun.com", port: 465, security: "tls" }, sentPolicy: "server" } : {}) }) }} disabled={model.busy}>{[{ value: "aliyun", title: "阿里企业邮箱" }, { value: "custom", title: "其他邮箱（IMAP / SMTP）" }].map(option => <FieldLabel key={option.value} htmlFor={`mail-provider-${option.value}`}><Field orientation="horizontal"><RadioGroupItem id={`mail-provider-${option.value}`} value={option.value} /><FieldTitle>{option.title}</FieldTitle></Field></FieldLabel>)}</RadioGroup></FieldSet> : <div className="space-y-4">
      <div className="space-y-1"><Label htmlFor="mail-email">邮箱地址</Label><Input id="mail-email" type="email" autoComplete="username" value={form.email} disabled={model.busy} onChange={event => model.change({ email: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="mail-credential">密码或应用专用密码</Label><InputGroup><InputGroupInput id="mail-credential" type={credentialVisible ? "text" : "password"} autoComplete="new-password" value={form.credential} disabled={model.busy} onChange={event => model.change({ credential: event.target.value })} data-track="mail.account.credential" /><InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={credentialVisible ? "隐藏密码" : "显示密码"} disabled={model.busy} onClick={() => setCredentialVisible(value => !value)}>{credentialVisible ? <EyeOff /> : <Eye />}</InputGroupButton></InputGroupAddon></InputGroup></div>
      <div className="flex justify-end"><Button variant="ghost" onClick={() => setAdvanced(value => !value)} aria-expanded={advanced}>高级设置</Button></div>
      {(advanced || form.provider === "custom") && <div className="space-y-5">
        <div className="space-y-1"><Label htmlFor="mail-account-name">显示名称</Label><Input data-track="mail.account.name" id="mail-account-name" value={form.name} disabled={model.busy} onChange={event => model.change({ name: event.target.value })} placeholder={form.email} /></div>
        <EndpointFields kind="IMAP" value={form.imap} disabled={model.busy} onChange={imap => model.change({ imap })} />
        <div className="space-y-1"><Label htmlFor="mail-imap-user">IMAP 用户名</Label><Input data-track="mail.account.imap_username" id="mail-imap-user" value={form.username ?? ""} disabled={model.busy} onChange={event => model.change({ username: event.target.value || undefined })} placeholder={form.email} /></div>
        <EndpointFields kind="SMTP" value={form.smtp} disabled={model.busy} onChange={smtp => model.change({ smtp })} />
        <div className="space-y-1"><Label htmlFor="mail-smtp-user">SMTP 用户名</Label><Input data-track="mail.account.smtp_username" id="mail-smtp-user" value={form.smtpUsername ?? ""} disabled={model.busy} onChange={event => model.change({ smtpUsername: event.target.value || undefined })} placeholder={form.username || form.email} /></div>
        <div className="space-y-1"><Label htmlFor="mail-sent-policy">已发送副本</Label><NativeSelect id="mail-sent-policy" className="w-full" value={form.provider === "aliyun" ? "server" : form.sentPolicy} disabled={model.busy || form.provider === "aliyun"} onChange={event => model.change({ sentPolicy: event.target.value as "server" | "client" })}><NativeSelectOption value="server">服务器自动保存</NativeSelectOption><NativeSelectOption value="client">由邮箱客户端保存</NativeSelectOption></NativeSelect></div>
      </div>}
    </div>}
    {model.error && <p role="alert" className="mt-4 text-sm text-destructive">{model.error}</p>}
  </GuidedFlow></DialogFrame></DialogContent></Dialog>
}
