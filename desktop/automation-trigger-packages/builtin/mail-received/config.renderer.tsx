import { Field, FieldLabel, FieldError } from "../../../src/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "../../../src/components/ui/select"
import { Button } from "../../../src/components/ui/button"
import { useMailTriggerAccounts } from "./use-mail-accounts"
import type { MailReceivedConfig } from "./schema"

export function MailReceivedConfigForm({ value, onChange }: { value: MailReceivedConfig; onChange(value: MailReceivedConfig): void }) {
  const { accounts, status, reload } = useMailTriggerAccounts()
  const missing = status === "ready" && Boolean(value.accountId) && !accounts.some(a => a.id === value.accountId)
  return <Field data-invalid={missing || status === "error"}>
    <FieldLabel htmlFor="automation-mail-account">邮箱账号</FieldLabel>
    <Select value={value.accountId ?? "__all__"} onValueChange={id => onChange(id === "__all__" ? {} : { accountId: id })} disabled={status !== "ready"}>
      <SelectTrigger id="automation-mail-account" aria-invalid={missing}><SelectValue placeholder="选择邮箱账号" /></SelectTrigger>
      <SelectContent><SelectGroup>
        <SelectItem value="__all__">全部邮箱账号</SelectItem>
        {accounts.map(account => <SelectItem key={account.id} value={account.id}>{account.name} · {account.email}</SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
    {missing ? <FieldError>邮箱账号不可用</FieldError> : null}
    {status === "loading" ? <span role="status">账号加载中</span> : null}
    {status === "unauthenticated" ? <FieldError>登录后可选择邮箱账号</FieldError> : null}
    {status === "error" ? <><FieldError>账号加载失败</FieldError><Button type="button" variant="outline" onClick={reload}>重试</Button></> : null}
  </Field>
}
