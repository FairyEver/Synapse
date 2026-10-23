import { useEffect, useRef } from "react"
import { RefreshCw, PenSquare, Settings } from "lucide-react"
import { toast } from "sonner"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import type { MailOpenRequest } from "../../../app-capabilities/mail/shared/private-schema"
import { useMail } from "./use-mail"
import { MailLayout, type ComposeIntent } from "./layout"
import { mailError } from "./api"
export function ExternalMailModule({ openRequest, onOpenRequestConsumed, onCompose, onSettings }: { openRequest?: MailOpenRequest | null; onOpenRequestConsumed?: (id: string) => void; onCompose?: (intent: ComposeIntent) => void; onSettings?: () => void } = {}) {
  const mail = useMail(), handled = useRef<string | null>(null)
  useEffect(() => {
    if (!openRequest || !mail.scope || handled.current === openRequest.requestId || !mail.authenticated) return
    if (openRequest.ownerId !== mail.owner || openRequest.generation !== mail.scope.generation) { handled.current = openRequest.requestId; onOpenRequestConsumed?.(openRequest.requestId); return }
    if (openRequest.accountId && mail.accountId !== openRequest.accountId) { mail.selectAccount(openRequest.accountId); return }
    handled.current = openRequest.requestId
    if (openRequest.configure) onSettings?.()
    if (openRequest.messageId) void mail.selectMessage(openRequest.messageId)
    onOpenRequestConsumed?.(openRequest.requestId)
  }, [openRequest, mail.accountId, mail.owner, mail.scope, mail.authenticated, onOpenRequestConsumed, onSettings])
  const settings = () => onSettings?.(), compose = (intent: ComposeIntent) => onCompose?.(intent)
  return <SystemAppWindowShell actions={<><SystemAppTopBarActionButton iconOnly aria-label="刷新邮箱" disabled={!mail.accountId || mail.loading} onClick={() => void mail.sync().catch(cause => toast.error(mailError(cause)))}><RefreshCw /></SystemAppTopBarActionButton><SystemAppTopBarActionButton iconOnly aria-label="邮箱设置" disabled={!onSettings || !mail.authenticated} onClick={settings}><Settings /></SystemAppTopBarActionButton><SystemAppTopBarActionButton disabled={!onCompose || !mail.accountId} onClick={() => compose({ accountId: mail.accountId! })}><PenSquare />写邮件</SystemAppTopBarActionButton></>}>
    <MailLayout mail={mail} onSettings={settings} onCompose={compose} />
  </SystemAppWindowShell>
}
