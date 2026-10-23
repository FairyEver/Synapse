import { sanitizeInertMailFragment } from "./inert-document"
import { MAIL_MAX_BODY_BYTES } from "../shared/limits"

// Only this application-owned stylesheet is allowed in the inert mail document.
const readingStyle = "html{color-scheme:light dark;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}body{display:flow-root;margin:0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.7;overflow-wrap:anywhere}body>:first-child{margin-top:0}body>:last-child{margin-bottom:0}p{margin:0 0 1em}p,li{text-wrap:pretty}strong,b{font-weight:600}h1,h2,h3,h4{font-weight:600;line-height:1.4;text-wrap:balance}blockquote{margin:1em 0;padding-inline-start:1em;border-inline-start:1px solid GrayText}blockquote blockquote{margin-block:.75em;padding-inline-start:.75em}pre{white-space:pre-wrap}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{overflow-wrap:anywhere}"
export interface ExternalLink { label: string; url: string }
export interface MailHtmlResources { cid: Readonly<Record<string, string>>; remote: Readonly<Record<string, string>> }
export function sanitizeMailHtml(source: string, resources: MailHtmlResources): { html: string; links: ExternalLink[]; blockedImages: number; remoteImages: string[] } {
  if (new TextEncoder().encode(source).length > MAIL_MAX_BODY_BYTES) throw new Error("邮件正文超过显示上限")
  const fragment = sanitizeInertMailFragment(source, {
    RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: ["p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "blockquote", "pre", "code", "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "h1", "h2", "h3", "h4"],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "colspan", "rowspan", "width", "height"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    // CID is resolved below, after sanitizing the rest of the tree. No arbitrary URLs survive.
    ADD_URI_SAFE_ATTR: ["src"],
  })
  let blockedImages = 0
  const remoteImages: string[] = [], links: ExternalLink[] = []
  for (const image of fragment.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? ""
    const key = src.startsWith("cid:") ? src.slice(4) : src
    const entries = src.startsWith("cid:") ? resources.cid : resources.remote
    const granted = Object.hasOwn(entries, key) ? entries[key] : undefined
    if (typeof granted === "string" && granted.startsWith("blob:")) image.setAttribute("src", granted)
    else {
      if (/^https?:/iu.test(src)) remoteImages.push(src)
      image.removeAttribute("src"); blockedImages++
    }
    for (const dimension of ["width", "height"]) {
      const value = image.getAttribute(dimension)
      if (value && (!/^\d{1,4}$/u.test(value) || Number(value) > 2000)) image.removeAttribute(dimension)
    }
  }
  for (const anchor of fragment.querySelectorAll("a")) {
    const value = anchor.getAttribute("href")
    anchor.removeAttribute("href")
    if (value && URL.canParse(value)) {
      const url = new URL(value)
      if (["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password) {
        const index = links.length
        links.push({ label: anchor.textContent?.trim() || url.hostname || value, url: url.toString() })
        // Only local fragments enter the frame; the parent handles approved URLs.
        anchor.setAttribute("href", `#mail-link-${index}`)
        anchor.setAttribute("data-mail-link", String(index))
      }
    }
  }
  const container = document.createElement("div"); container.append(...fragment.childNodes)
  const csp = "default-src 'none'; img-src blob:; style-src 'nonce-synapse-mail-typography'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  return { html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style nonce="synapse-mail-typography">${readingStyle}</style></head><body>${container.innerHTML}</body></html>`, links, blockedImages, remoteImages: [...new Set(remoteImages)] }
}
