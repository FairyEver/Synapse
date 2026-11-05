import { useCallback, useEffect, useRef, useState } from "react"
import type { Draft, DraftInput, MailDetail, SendReceipt } from "../../../app-capabilities/mail/shared/types"
import { mailApi, mailError } from "./api"

type PreparedQuickReply = {
  readonly base: Draft
  readonly draft: Draft
  readonly contentKey: string
}

type PendingQuickReply = {
  readonly contentKey: string
  readonly previewId: string
  readonly clientRequestId: string
}

function escapeReplyHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replace(/\r?\n/gu, "<br>")
}

function quickReplyContent(base: Draft, body: string): DraftInput {
  return {
    accountId: base.accountId,
    to: base.to,
    cc: base.cc,
    bcc: base.bcc,
    subject: base.subject,
    html: `<p>${escapeReplyHtml(body)}</p>${base.html}`,
    text: `${body}${base.text}`,
    assetIds: base.assetIds,
    inlineImages: base.inlineImages,
  }
}

function quickReplyPatch(content: DraftInput): Omit<DraftInput, "accountId"> {
  return {
    to: content.to,
    cc: content.cc,
    bcc: content.bcc,
    subject: content.subject,
    html: content.html,
    text: content.text,
    assetIds: content.assetIds,
    inlineImages: content.inlineImages,
  }
}

export function useMailQuickReply(source: MailDetail | null) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const prepared = useRef<PreparedQuickReply | null>(null)
  const pending = useRef<PendingQuickReply | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    busyRef.current = false
    prepared.current = null
    pending.current = null
    setBody("")
    setBusy(false)
    setError(null)
  }, [source?.id])

  const send = useCallback(async (): Promise<SendReceipt | null> => {
    if (!source || busyRef.current) return null
    const replyBody = body.trim()
    if (!replyBody) return null

    const requestGeneration = generation.current
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      let current = prepared.current
      if (current && current.draft.state !== "editing") current = null

      if (!current) {
        const base = await mailApi().draftPrepare({
          accountId: source.accountId,
          sourceMessageId: source.id,
          mode: "reply",
          forwardMode: "inline",
        })
        if (requestGeneration !== generation.current) return null
        const content = quickReplyContent(base, replyBody)
        const draft = await mailApi().draftCommit({
          content,
          source: { messageId: source.id, mode: "reply" },
        })
        if (requestGeneration !== generation.current) return null
        current = { base, draft, contentKey: JSON.stringify(content) }
        prepared.current = current
        pending.current = null
      } else {
        const content = quickReplyContent(current.base, replyBody)
        const contentKey = JSON.stringify(content)
        if (contentKey !== current.contentKey) {
          const draft = await mailApi().draftUpdate({
            draftId: current.draft.id,
            expectedRevision: current.draft.revision,
            patch: quickReplyPatch(content),
          })
          if (requestGeneration !== generation.current) return null
          current = { ...current, draft, contentKey }
          prepared.current = current
          pending.current = null
        }
      }

      if (!pending.current || pending.current.contentKey !== current.contentKey) {
        const preview = await mailApi().sendPreview({
          draftId: current.draft.id,
          expectedRevision: current.draft.revision,
        })
        if (requestGeneration !== generation.current) return null
        pending.current = {
          contentKey: current.contentKey,
          previewId: preview.previewId,
          clientRequestId: crypto.randomUUID(),
        }
      }

      const receipt = await mailApi().messageSend({
        previewId: pending.current.previewId,
        clientRequestId: pending.current.clientRequestId,
        confirmed: true,
      })
      if (requestGeneration !== generation.current) return null
      if (receipt.state === "failed") {
        pending.current = null
        setError("发送失败，请重试。")
        return null
      }
      if (receipt.state !== "accepted" && receipt.state !== "partial") {
        setError("发送结果待核验，请重试。")
        return null
      }
      prepared.current = null
      pending.current = null
      return receipt
    } catch (cause) {
      if (requestGeneration !== generation.current) return null
      const message = mailError(cause)
      if (message.includes("发送预览已过期") || message.includes("预览已过期")) {
        pending.current = null
        setError("发送预览已过期，请重试。")
      } else {
        setError(message)
      }
      return null
    } finally {
      if (requestGeneration === generation.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }, [body, source])

  return { body, setBody, busy, error, send }
}
