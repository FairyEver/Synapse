import { useLayoutEffect, useRef, useState } from "react"
import { track } from "@/lib/ui-tracking"
import type { sanitizeMailHtml } from "../../../app-capabilities/mail/renderer/sanitize-body"

export function MailHtmlBody({ projection, onLink }: { projection: ReturnType<typeof sanitizeMailHtml>; onLink(url: string): void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const current = useRef({ projection, onLink })
  const [height, setHeight] = useState(1)
  useLayoutEffect(() => { current.current = { projection, onLink } }, [projection, onLink])

  useLayoutEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    let disconnect: (() => void) | undefined
    const connect = () => {
      disconnect?.()
      const doc = iframe.contentDocument
      if (!doc?.body) return
      // Isolated documents do not inherit the application's theme tokens.
      const themeRoot = iframe.ownerDocument.documentElement
      const syncTheme = () => {
        const theme = getComputedStyle(themeRoot)
        for (const token of ["--link", "--link-hover", "--foreground", "--background"]) {
          doc.documentElement.style.setProperty(token, theme.getPropertyValue(token))
        }
        doc.documentElement.style.colorScheme = themeRoot.classList.contains("dark") ? "dark" : "light"
      }
      const themeObserver = new MutationObserver(syncTheme)
      themeObserver.observe(themeRoot, { attributes: true, attributeFilter: ["class", "style"] })
      syncTheme()
      let pendingFrame: number | undefined
      const measure = () => {
        pendingFrame = undefined
        // Body height can shrink as well as grow, unlike the viewport's scrollHeight.
        const next = Math.max(1, Math.ceil(doc.body.getBoundingClientRect().height))
        setHeight(previous => previous === next ? previous : next)
      }
      const observer = new ResizeObserver(() => {
        if (pendingFrame === undefined) pendingFrame = requestAnimationFrame(measure)
      })
      const openLink = (event: MouseEvent) => {
        const anchor = (event.target as Element | null)?.closest?.("a[data-mail-link]")
        if (!anchor) return
        event.preventDefault()
        if (event.type === "auxclick" && event.button !== 1) return
        const index = Number(anchor.getAttribute("data-mail-link"))
        const link = Number.isInteger(index) ? current.current.projection.links[index] : undefined
        if (!link) return
        track({ component: "mail", name: "mail.link.open", eventKey: "mail.link.open", action: "click" })
        current.current.onLink(link.url)
      }
      doc.addEventListener("click", openLink)
      doc.addEventListener("auxclick", openLink)
      observer.observe(doc.body)
      measure()
      disconnect = () => {
        themeObserver.disconnect()
        observer.disconnect()
        if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame)
        doc.removeEventListener("click", openLink)
        doc.removeEventListener("auxclick", openLink)
      }
    }
    iframe.addEventListener("load", connect)
    return () => { iframe.removeEventListener("load", connect); disconnect?.() }
  }, [projection.html])

  return <iframe ref={frame} title="邮件正文" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={projection.html} scrolling="no" className="block w-full border-0" style={{ height }} />
}
