import { sanitizeInertMailFragment } from "./inert-document"
import { MAIL_MAX_BODY_BYTES } from "../shared/limits"
import type { Draft } from "../shared/types"

/** Basic pasted formatting only. Remote images are not fetched or embedded. */
export function sanitizeComposeDocument(source: string, images: Draft["inlineImages"]): { html: string; text: string } {
  if (new TextEncoder().encode(source).length > MAIL_MAX_BODY_BYTES) throw new Error("正文超过大小上限")
  const fragment = sanitizeInertMailFragment(source, { RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "s", "span", "ul", "ol", "li", "blockquote", "a", "img"], ALLOWED_ATTR: ["href", "src", "alt", "style"], ADD_URI_SAFE_ATTR: ["src"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false })
  for (const element of fragment.querySelectorAll("[style]")) {
    const style = element.getAttribute("style") ?? ""
    const font = style.match(/(?:^|;)\s*font-size:\s*(\d+(?:\.\d+)?)(px|pt)\s*(?:;|$)/iu)
    element.removeAttribute("style")
    if (font && Number(font[1]) >= 8 && Number(font[1]) <= 48) element.setAttribute("style", `font-size: ${font[1]}${font[2].toLowerCase()}`)
  }
  for (const image of fragment.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "", asset = images.find(image => source === `cid:${image.cid}`)
    if (!asset) image.remove()
    else image.setAttribute("data-asset-id", asset.assetId)
  }
  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href")
    if (!href || !URL.canParse(href) || !["http:", "https:", "mailto:"].includes(new URL(href).protocol)) link.removeAttribute("href")
  }
  const html = document.createElement("div"); html.append(...fragment.childNodes)
  const text = html.cloneNode(true) as HTMLDivElement
  for (const block of text.querySelectorAll("p,li,blockquote,br")) block.append(document.createTextNode("\n"))
  return { html: html.innerHTML, text: text.textContent?.trim() ?? "" }
}
