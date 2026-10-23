import nodemailer from "nodemailer"
import type SMTPTransport from "nodemailer/lib/smtp-transport"
import type { AccountConfig, MailContext } from "../../shared/types"
import type { MailAccess } from "../assets"
import { protocolCall, type MailSmtp, type SmtpSnapshot } from "./types"

export function smtpOptions(config: AccountConfig, credential: string): SMTPTransport.Options {
  return { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.security === "tls", requireTLS: config.smtp.security === "starttls",
    auth: { user: config.smtpUsername ?? config.username ?? config.email, pass: credential }, tls: { rejectUnauthorized: true },
    logger: false, debug: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    disableFileAccess: true, disableUrlAccess: true,
  }
}
export async function connectSmtp(ctx: MailContext, config: AccountConfig, credential: string, access: MailAccess): Promise<MailSmtp> {
  await access(ctx, "network.connect", `${config.smtp.host}:${config.smtp.port}`)
  const transport = nodemailer.createTransport(smtpOptions(config, credential))
  return {
    async verify(signal) { await protocolCall(signal, () => transport.close(), async () => { await transport.verify() }) },
    async submit(snapshot: SmtpSnapshot, signal) {
      const info = await protocolCall(signal, () => transport.close(), () => transport.sendMail({ raw: snapshot.raw, envelope: { from: snapshot.from, to: snapshot.to } }))
      const address = (a: string | { address: string }) => typeof a === "string" ? a : a.address
      return { accepted: info.accepted.map(address), rejected: info.rejected.map(address), messageId: snapshot.messageId }
    },
    close() { transport.close() },
  }
}
