import { useEffect, useRef, useState } from "react"
import type { MailDetail } from "../../../app-capabilities/mail/shared/types"
import { MAIL_MAX_BODY_BYTES } from "../../../app-capabilities/mail/shared/limits"
import type { MailHtmlResources } from "../../../app-capabilities/mail/renderer/sanitize-body"
import { mailApi, mailError } from "./api"
export interface MailBody { html: string; text: string; complete: boolean; truncated: boolean }
const emptyResources = (): MailHtmlResources => ({ cid: {}, remote: {} })
export function useMailBody(detail: MailDetail | null, owner: string | null, onInvalidated?: () => void) {
  const [body, setBody] = useState<MailBody | null>(null), [resources, setResources] = useState<MailHtmlResources>(emptyResources)
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false)
  const remoteLoading = useRef<number | null>(null)
  const epoch = useRef(0), blobs = useRef<string[]>([]), current = useRef({ id: detail?.id, owner }); current.current = { id: detail?.id, owner }
  const reset = () => { for (const blob of blobs.current) URL.revokeObjectURL(blob); blobs.current = [] }
  const makeBlob = async (messageId: string, token: string, e: number) => {
    const image = await mailApi().imageRead({ messageId, token })
    if (epoch.current !== e || current.current.id !== messageId) throw new Error("邮件已变化")
    const binary = atob(image.base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: image.mime })); blobs.current.push(url); return url
  }
  useEffect(() => {
    const e = ++epoch.current; reset(); setBody(null); setResources(emptyResources()); setError(null)
    if (!detail) { setLoading(false); return }
    const id = detail.id, identity = owner
    const valid = () => e === epoch.current && current.current.owner === identity && current.current.id === id
    setLoading(true)
    void (async () => {
      let cursor: string | undefined, bodyRef: string | undefined, html = "", text = "", bytes = 0
      do {
        const chunk = await mailApi().bodyReadChunk({ messageId: id, cursor, bodyRef })
        if (!valid()) return
        bytes += new TextEncoder().encode(chunk.html + chunk.text).length
        if (bytes > MAIL_MAX_BODY_BYTES) throw new Error("邮件正文超过显示上限")
        html += chunk.html; text += chunk.text; bodyRef = chunk.bodyRef; cursor = chunk.nextCursor ?? undefined
        if (chunk.truncated || !cursor && !chunk.complete) { setBody({ html: "", text, complete: false, truncated: true }); return }
      } while (cursor)
      if (!valid()) return
      setBody({ html, text, complete: true, truncated: false })
      const cid: Record<string, string> = {}
      for (const asset of detail.attachments.filter(a => a.cid && html.includes(`cid:${a.cid}`))) {
        try {
          const grant = await mailApi().imageGrant({ messageId: id, assetId: asset.id })
          if (!valid()) return
          cid[asset.cid!] = await makeBlob(id, grant.token, e)
        } catch (cause) { if (valid()) setError(mailError(cause)) }
      }
      if (valid()) setResources({ cid, remote: {} })
    })().catch(cause => {
      if (!valid()) return
      setError(mailError(cause))
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "STALE_TARGET") onInvalidated?.()
    }).finally(() => { if (valid()) setLoading(false) })
    return () => { epoch.current++; reset() }
  }, [detail?.id, owner, onInvalidated])
  const loadRemote = async (urls: string[]) => {
    if (!detail) return
    const e = epoch.current, id = detail.id, identity = owner
    const valid = () => e === epoch.current && current.current.owner === identity && current.current.id === id
    if (!valid() || remoteLoading.current === e) return
    remoteLoading.current = e
    setLoading(true); setError(null)
    let failed = 0, firstError = ""
    try {
      for (const url of [...new Set(urls)].filter(url => !Object.hasOwn(resources.remote, url)).slice(0, 100)) {
        if (!valid()) return
        try {
          const grant = await mailApi().imageRemote({ messageId: id, url, allowed: true })
          if (!valid()) return
          const blob = await makeBlob(id, grant.token, e)
          if (!valid()) return
          setResources(previous => valid() ? { cid: previous.cid, remote: { ...previous.remote, [url]: blob } } : previous)
        } catch (cause) {
          if (!valid()) return
          failed++; firstError ||= mailError(cause)
          setError(`${failed} 张图片加载失败：${firstError}`)
        }
      }
    } finally {
      if (remoteLoading.current === e) remoteLoading.current = null
      if (valid()) setLoading(false)
    }
  }
  return { body, resources, loading, error, loadRemote }
}
