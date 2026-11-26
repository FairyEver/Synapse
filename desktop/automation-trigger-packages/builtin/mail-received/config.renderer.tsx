import { useEffect, useState } from "react"
import { requestOpenSettingsAccount } from "../../../src/app-shell/navigation"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "../../../src/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "../../../src/components/ui/select"
import { Input } from "../../../src/components/ui/input"
import { Checkbox } from "../../../src/components/ui/checkbox"
import { Button } from "../../../src/components/ui/button"
import { useMailTriggerAccounts } from "./use-mail-accounts"
import type { MailReceivedConfig } from "./schema"

const LIST_SEPARATOR_PATTERN = /[,，;；\n]+/u

function parseFilterList(raw: string): string[] | undefined {
  const items = raw.split(LIST_SEPARATOR_PATTERN).map(item => item.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function formatFilterList(items: readonly string[] | undefined): string {
  return items?.length ? items.join(", ") : ""
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a?.length && !b?.length) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((item, index) => item === b[index])
}

export function MailReceivedConfigForm({ value, onChange }: { value: MailReceivedConfig; onChange(value: MailReceivedConfig): void }) {
  const { accounts, status, reload, openAccounts, setupError } = useMailTriggerAccounts()
  const missing = status === "ready" && Boolean(value.accountId) && !accounts.some(a => a.id === value.accountId)
  const [senderText, setSenderText] = useState(() => formatFilterList(value.senderMatches))
  const [subjectText, setSubjectText] = useState(() => formatFilterList(value.subjectContains))

  useEffect(() => {
    setSenderText(prev => sameList(parseFilterList(prev), value.senderMatches) ? prev : formatFilterList(value.senderMatches))
  }, [value.senderMatches])

  useEffect(() => {
    setSubjectText(prev => sameList(parseFilterList(prev), value.subjectContains) ? prev : formatFilterList(value.subjectContains))
  }, [value.subjectContains])

  const patch = (next: Partial<MailReceivedConfig>) => {
    const merged: MailReceivedConfig = { ...value, ...next }
    const cleaned: MailReceivedConfig = {}
    if (merged.accountId) cleaned.accountId = merged.accountId
    if (merged.senderMatches?.length) cleaned.senderMatches = merged.senderMatches
    if (merged.subjectContains?.length) cleaned.subjectContains = merged.subjectContains
    if (merged.originalOnly) cleaned.originalOnly = true
    onChange(cleaned)
  }

  return (
    <div className="grid gap-4">
      <Field data-invalid={missing || status === "error"}>
        <FieldLabel htmlFor="automation-mail-account">邮箱账号</FieldLabel>
        <Select value={value.accountId ?? "__all__"} onValueChange={id => patch({ accountId: id === "__all__" ? undefined : id })} disabled={status !== "ready"}>
          <SelectTrigger id="automation-mail-account" aria-invalid={missing}><SelectValue placeholder="选择邮箱账号" /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="__all__">全部邮箱账号</SelectItem>
            {accounts.map(account => <SelectItem key={account.id} value={account.id}>{account.name}{account.name !== account.email && ` · ${account.email}`}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select>
        {status === "ready" && !accounts.length ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">尚无邮箱账号</span><Button type="button" variant="outline" onClick={() => { void openAccounts() }}>添加邮箱账号</Button></div> : null}
        {setupError ? <FieldError>{setupError}</FieldError> : null}
        {missing ? <FieldError>邮箱账号不可用</FieldError> : null}
        {status === "loading" ? <span role="status">账号加载中</span> : null}
        {status === "unauthenticated" ? <><FieldError>登录后可选择邮箱账号</FieldError><Button type="button" variant="outline" onClick={requestOpenSettingsAccount}>登录</Button></> : null}
        {status === "error" ? <><FieldError>账号加载失败</FieldError><Button type="button" variant="outline" onClick={reload}>重试</Button></> : null}
      </Field>

      <Field>
        <FieldLabel htmlFor="automation-mail-sender-matches">发件人过滤（可选）</FieldLabel>
        <FieldContent>
          <Input
            id="automation-mail-sender-matches"
            name="senderMatches"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="automation-mail-sender-matches-help"
            placeholder="例如 @world-tech.com.cn，多个用逗号分隔"
            value={senderText}
            onChange={(event) => {
              const raw = event.target.value
              setSenderText(raw)
              patch({ senderMatches: parseFilterList(raw) })
            }}
          />
          <FieldDescription id="automation-mail-sender-matches-help">匹配发件域名或完整邮箱地址，命中任一项即通过。</FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="automation-mail-subject-contains">主题关键词（可选）</FieldLabel>
        <FieldContent>
          <Input
            id="automation-mail-subject-contains"
            name="subjectContains"
            autoComplete="off"
            aria-describedby="automation-mail-subject-contains-help"
            placeholder="例如 部署，多个用逗号分隔"
            value={subjectText}
            onChange={(event) => {
              const raw = event.target.value
              setSubjectText(raw)
              patch({ subjectContains: parseFilterList(raw) })
            }}
          />
          <FieldDescription id="automation-mail-subject-contains-help">不区分大小写，主题包含任一关键词即通过。</FieldDescription>
        </FieldContent>
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="automation-mail-original-only"
          data-track="automation-mail-original-only"
          checked={Boolean(value.originalOnly)}
          onCheckedChange={(checked) => patch({ originalOnly: checked === true ? true : undefined })}
        />
        <FieldLabel htmlFor="automation-mail-original-only">仅原发新邮件（排除回复与转发）</FieldLabel>
      </Field>
    </div>
  )
}
