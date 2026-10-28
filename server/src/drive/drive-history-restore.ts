import { createHash } from "node:crypto"
import { Readable } from "node:stream"

type RestoreTarget =
  | { readonly kind: "share"; readonly shareId: string; readonly itemId?: string }
  | { readonly kind: "site"; readonly siteId: string; readonly relativePath: string }
type RestoreScript = { readonly source: string; readonly html: string; readonly cspHash: string }

/** The initial navigation is recorded by the controller; only BFCache restores report from HTML. */
export function buildDriveHistoryRestoreScript(target: RestoreTarget): RestoreScript {
  const endpoint = target.kind === "site"
    ? `/api/drive/browser/sites/${encodeURIComponent(target.siteId)}/visits`
    : `/api/drive/browser/shares/${encodeURIComponent(target.shareId)}${target.itemId ? `/items/${encodeURIComponent(target.itemId)}` : ""}/visits`
  const payload = target.kind === "site" ? { relativePath: target.relativePath } : {}
  const literal = (value: unknown) => JSON.stringify(value).replace(/</gu, "\\u003c")
  const source = `(() => {
  if (window.top !== window.self) return
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return
    const body = ${literal(payload)}
    body.visitId = crypto.randomUUID()
    const report = () => fetch(${literal(endpoint)}, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(response => { if (!response.ok) throw new Error("History restore report failed") })
    report().catch(() => report().catch(() => console.warn({ event: "drive.browsing-history.restore.failed" })))
  })
})()`
  return { source, html: `<script>${source}</script>`, cspHash: `sha256-${createHash("sha256").update(source).digest("base64")}` }
}

/** Appending preserves the source BOM/doctype and streams bytes without decoding or buffering the page. */
export function appendDriveHistoryRestoreScript(stream: NodeJS.ReadableStream, script: RestoreScript): Readable {
  return Readable.from((async function* () {
    for await (const chunk of stream as Readable) yield chunk
    yield Buffer.from(script.html)
  })(), { objectMode: false })
}
