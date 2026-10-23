import type { MailAccess } from "../assets"
import { connectImap } from "./imap"
import { connectSmtp } from "./smtp"
import type { MailProtocols } from "./types"

export function createMailProtocols(access: MailAccess): MailProtocols {
  return {
    imap: (ctx, config, credential) => connectImap(ctx, config, credential, access),
    smtp: (ctx, config, credential) => connectSmtp(ctx, config, credential, access),
  }
}
