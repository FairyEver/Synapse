import { useCallback, useEffect, useRef } from "react"
import { RefreshCw, PenSquare, Settings } from "lucide-react"
import { toast } from "sonner"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import type { MailOpenRequest } from "../../../app-capabilities/mail/shared/private-schema"
import { useMail } from "./use-mail"
import { MailLayout, type ComposeIntent } from "./layout"
import { MailCompose } from "./compose"
import { MailAccountDialog } from "./account-dialog"
import { MailSettings } from "./settings"
import { useCompose } from "./use-compose"
import { useMailAccounts } from "./use-mail-accounts"
import { mailError } from "./api"
export function ExternalMailModule({ openRequest, onOpenRequestConsumed }: { openRequest?: MailOpenRequest | null; onOpenRequestConsumed?: (id: string) => void } = {}) {
  const mail = useMail(), handled = useRef<string | null>(null), editor = useCompose(mail.owner)
  const saved = useCallback(async () => { await mail.loadAccounts(); await mail.refresh() }, [mail.loadAccounts, mail.refresh])
  const accountModel = useMailAccounts(mail.owner, saved)
  const settings = () => { if (!mail.accounts.length) accountModel.begin(); else accountModel.setSettingsOpen(true) }
  const compose = (intent: ComposeIntent) => { void editor.open(intent).catch(cause => toast.error(mailError(cause))) }
  useEffect(() => {
    if (!openRequest || !mail.scope || handled.current === openRequest.requestId || !mail.authenticated) return
    if (openRequest.ownerId !== mail.owner || openRequest.generation !== mail.scope.generation) { handled.current = openRequest.requestId; onOpenRequestConsumed?.(openRequest.requestId); return }
    if (openRequest.accountId && mail.accountId !== openRequest.accountId) { mail.selectAccount(openRequest.accountId); return }
    handled.current = openRequest.requestId
    if (openRequest.configure) settings()
    if (openRequest.messageId) void mail.selectMessage(openRequest.messageId)
    onOpenRequestConsumed?.(openRequest.requestId)
  }, [openRequest, mail.accountId, mail.owner, mail.scope, mail.authenticated, onOpenRequestConsumed])
  return <SystemAppWindowShell actions={<><SystemAppTopBarActionButton iconOnly aria-label="刷新邮箱" disabled={!mail.accountId || mail.loading} onClick={() => void mail.sync().catch(cause => toast.error(mailError(cause)))}><RefreshCw /></SystemAppTopBarActionButton><SystemAppTopBarActionButton iconOnly aria-label="邮箱设置" disabled={!mail.authenticated} onClick={settings}><Settings /></SystemAppTopBarActionButton><SystemAppTopBarActionButton disabled={!mail.accountId || editor.loading} onClick={() => compose({ accountId: mail.accountId! })}><PenSquare />写邮件</SystemAppTopBarActionButton></>}>
    <MailLayout mail={mail} onSettings={settings} onCompose={compose} />
    <MailCompose model={editor} accounts={mail.accounts} />
    <MailAccountDialog model={accountModel} />
    <MailSettings model={accountModel} mail={mail} />
  </SystemAppWindowShell>
}
