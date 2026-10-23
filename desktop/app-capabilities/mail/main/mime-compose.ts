import { createHash } from "node:crypto"
import nodemailer from "nodemailer"
import type { Readable } from "node:stream"
import { MAIL_MAX_ATTACHMENT_BYTES, MAIL_MAX_IMAGE_BYTES } from "../shared/limits"
import { MailError, type Draft, type MailContext } from "../shared/types"
import { MailAssets } from "./assets"
import type { SmtpSnapshot } from "./protocol/types"
import { rasterMime } from "./body-resources"

export interface ComposeHeaders { messageId: string; date: string; from: string; inReplyTo: string | null; references: string[]; keepBcc: boolean }
export async function compileDraftMime(ctx: MailContext, draft: Draft, assets: MailAssets, headers: ComposeHeaders): Promise<SmtpSnapshot> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: false, newline: "windows", disableFileAccess: true, disableUrlAccess: true })
  const opened: Readable[] = []
  try {
    const ids = [...new Set([...draft.assetIds, ...draft.inlineImages.map(image => image.assetId)])]
    const attachments: { filename: string; contentType: string; content: Readable; cid?: string }[] = []
    let decodedBytes = Buffer.byteLength(draft.html) + Buffer.byteLength(draft.text)
    for (const id of ids) {
      const asset = await assets.info(ctx, id)
      if (asset.accountId !== draft.accountId || asset.state !== "ready" || !asset.sha256) throw new MailError("UNAVAILABLE", "草稿附件不可用")
      decodedBytes += asset.size
      if (decodedBytes > MAIL_MAX_ATTACHMENT_BYTES) throw new MailError("LIMIT_EXCEEDED", "邮件总大小超过上限")
      const content = await assets.open(ctx, id); opened.push(content)
      const image = draft.inlineImages.find(image => image.assetId === id)
      const contentType = image ? rasterMime(await assets.read(ctx, id, MAIL_MAX_IMAGE_BYTES)) : asset.mime
      if (!contentType) throw new MailError("IMAGE_BLOCKED", "内嵌图片格式无效")
      attachments.push({ filename: asset.name, contentType, content, ...(image ? { cid: image.cid } : {}) })
    }
    const envelope = { from: headers.from, to: [...new Set([...draft.to, ...draft.cc, ...draft.bcc].map(a => a.address))] }
    const addresses = (values: Draft["to"]) => values.map(a => ({ address: a.address, name: a.name ?? "" }))
    // StreamTransport intentionally keeps Bcc. SMTP snapshots therefore omit the
    // header entirely while retaining every recipient in the explicit envelope.
    const info = await transport.sendMail({ from: headers.from, to: addresses(draft.to), cc: addresses(draft.cc), bcc: headers.keepBcc ? addresses(draft.bcc) : undefined, subject: draft.subject, html: draft.html || undefined, text: draft.text, messageId: headers.messageId, date: new Date(headers.date), inReplyTo: headers.inReplyTo ?? undefined, references: headers.references, attachments, envelope })
    const chunks: Buffer[] = []; let size = 0
    const stream = info.message
    if (Buffer.isBuffer(stream)) throw new MailError("MIME_INVALID", "MIME 流配置无效")
    for await (const chunk of stream) {
      ctx.signal.throwIfAborted(); size += chunk.length
      if (size > MAIL_MAX_ATTACHMENT_BYTES) { stream.destroy(); throw new MailError("LIMIT_EXCEEDED", "编码后的邮件超过大小上限") }
      chunks.push(chunk)
    }
    const raw = Buffer.concat(chunks, size)
    // Read streams are controlled assets, never arbitrary URLs or local paths from draft HTML.
    for (const id of ids) {
      const asset = await assets.info(ctx, id)
      const actual = createHash("sha256").update(await assets.read(ctx, id)).digest("hex")
      if (actual !== asset.sha256) throw new MailError("ASSET_CHANGED", "附件内容已变化，请重新保存草稿")
    }
    return { raw, from: envelope.from, to: envelope.to, messageId: headers.messageId }
  } finally { for (const stream of opened) stream.destroy(); transport.close() }
}
