import DOMPurify, { type Config } from "dompurify"
/** Template contents have an inert owner document. Never give an armed email
 * string to DOMParser or adopt it into the live document before sanitizing. */
export function sanitizeInertMailFragment(source: string, config: Config): HTMLDivElement {
  const template = document.createElement("template")
  template.innerHTML = source
  const root = template.content.ownerDocument.createElement("div")
  root.append(template.content)
  DOMPurify.sanitize(root, { ...config, ALLOWED_TAGS: [...new Set(["div", ...(config.ALLOWED_TAGS ?? [])])], IN_PLACE: true })
  return root
}
