import SMTPConnection from "nodemailer/lib/smtp-connection"
import type SMTPTransport from "nodemailer/lib/smtp-transport"
import { MailError, type AccountConfig, type MailContext } from "../../shared/types"
import type { MailAccess } from "../assets"
import { protocolCall, type MailSmtp, type SmtpSnapshot, type SmtpReceipt } from "./types"

export function smtpOptions(config: AccountConfig, credential: string): SMTPTransport.Options {
  return { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.security === "tls", requireTLS: config.smtp.security === "starttls",
    auth: { user: config.smtpUsername ?? config.username ?? config.email, pass: credential }, tls: { rejectUnauthorized: true },
    logger: false, debug: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    disableFileAccess: true, disableUrlAccess: true,
  }
}
export async function connectSmtp(ctx: MailContext, config: AccountConfig, credential: string, access: MailAccess): Promise<MailSmtp> {
  await access(ctx, "network.connect", `${config.smtp.host}:${config.smtp.port}`)
  let active: SMTPConnection | null = null, closed = false
  const closeActive = () => active?.close()
  const close = () => { closed = true; closeActive() }
  const run = async (signal: AbortSignal, snapshot?: SmtpSnapshot): Promise<SmtpReceipt | undefined> => {
    if (closed || active) throw new MailError("CANCELLED", "邮箱连接已关闭或正在使用")
    try {
      return await protocolCall(signal, close, () => new Promise<SmtpReceipt | undefined>((resolve, reject) => {
        // SMTPTransport.close() does not abort a non-pooled send. Own the actual
        // connection so identity changes, pause and deadlines destroy its socket.
        const connection = new SMTPConnection(smtpOptions(config, credential)); active = connection
        let finished = false
        const finish = (error?: unknown, receipt?: SmtpReceipt) => { if (finished) return; finished = true; if (error) reject(error); else resolve(receipt) }
        const stopped = () => finished || closed || signal.aborted || connection.destroyed
        connection.once("error", error => { if (!closed && !signal.aborted) finish(error) })
        connection.once("end", () => { if (!closed && !signal.aborted) finish(new MailError("NETWORK_ERROR", "邮箱连接已关闭，请先核验结果")) })
        connection.connect(error => {
          if (error) { finish(error); return }
          if (stopped()) return
          connection.login({ user: config.smtpUsername ?? config.username ?? config.email, pass: credential }, error => {
            if (error) { finish(error); return }
            if (stopped()) return
            if (!snapshot) { finish(); return }
            connection.send({ from: snapshot.from, to: snapshot.to }, snapshot.raw, (error, info) => {
              if (error) { finish(error); return }
              if (stopped()) return
              finish(undefined, { accepted: info.accepted, rejected: info.rejected, messageId: snapshot.messageId })
            })
          })
        })
      }))
    } finally { closeActive(); active = null }
  }
  return {
    async verify(signal) { await run(signal) },
    async submit(snapshot, signal) { const receipt = await run(signal, snapshot); if (!receipt) throw new MailError("NETWORK_ERROR", "发送回执不可用，请先核验结果"); return receipt },
    close,
  }
}
