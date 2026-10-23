import DOMPurify from "dompurify"
import { MAIL_MAX_BODY_BYTES } from "../shared/limits"

export interface ExternalLink { label: string; url: string }
export interface MailHtmlResources { cid: Readonly<Record<string, string>>; remote: Readonly<Record<string, string>> }
export function sanitizeMailHtml(source: string, resources: MailHtmlResources): { html: string; links: ExternalLink[]; blockedImages: number; remoteImages: string[] } {
  if (new TextEncoder().encode(source).length > MAIL_MAX_BODY_BYTES) throw new Error("邮件正文超过显示上限")
  const fragment = DOMPurify.sanitize(source, {
    RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: ["p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "blockquote", "pre", "code", "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "h1", "h2", "h3", "h4"],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "colspan", "rowspan", "width", "height"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    // CID is resolved below, after sanitizing the rest of the tree. No arbitrary URLs survive.
    ADD_URI_SAFE_ATTR: ["src"],
  })
  let blockedImages = 0
  const remoteImages: string[] = [], links: ExternalLink[] = []
  for (const image of fragment.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? ""
    const granted = src.startsWith("cid:") ? resources.cid[src.slice(4)] : resources.remote[src]
    if (granted?.startsWith("blob:")) image.setAttribute("src", granted)
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
    if (value && URL.canParse(value)) {
      const url = new URL(value)
      if (["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password) links.push({ label: anchor.textContent?.trim() || url.hostname || value, url: url.toString() })
    }
    anchor.removeAttribute("href")
  }
  const container = document.createElement("div"); container.append(fragment)
  const csp = "default-src 'none'; img-src blob:; style-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  return { html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${container.innerHTML}</body></html>`, links, blockedImages, remoteImages: [...new Set(remoteImages)] }
}
