import { useEffect, useRef } from "react"
import type { MailOpenRequest } from "../../../app-capabilities/mail/shared/private-schema"
import { MailCompose } from "./compose"
import { useCompose } from "./use-compose"
import { useMail } from "./use-mail"

export function MailComposeWindow({ request }: { request: MailOpenRequest | null }) {
  const mail = useMail()
  const scope = mail.scope
  const valid = !!request?.compose && scope?.ownerId === request.ownerId && scope?.generation === request.generation && mail.owner === request.ownerId
  const editor = useCompose(valid ? `${request.ownerId}:${request.generation}` : null, () => window.close())
  const opened = useRef(false)
  const open = () => {
    if (valid && request.compose) void editor.open(request.compose).catch(() => undefined)
  }
  useEffect(() => {
    if (!valid || opened.current) return
    opened.current = true
    open()
  }, [valid, editor.open])
  useEffect(() => {
    if (opened.current && (!mail.owner || scope && !valid)) window.close()
  }, [mail.owner, scope, valid])
  return <MailCompose model={editor} accounts={mail.accounts} onRetry={open} unavailable={scope && !valid ? "邮箱身份已变化，请重新打开写信窗口" : mail.error} />
}
