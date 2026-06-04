import { createRequire } from "node:module"

import TurndownService from "turndown"

const requireFromHere = createRequire(__filename)
const { gfm } = requireFromHere("turndown-plugin-gfm") as { readonly gfm: TurndownService.Plugin }

export function htmlToMarkdown(html: string): string {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  })
  service.use(gfm)
  service.addRule("dropDataUriImages", {
    filter: (node) => {
      const element = node as { readonly nodeName?: string; getAttribute?: (name: string) => string | null }
      const src = element.nodeName === "IMG" ? element.getAttribute?.("src") : null
      return typeof src === "string" && src.toLowerCase().startsWith("data:image/")
    },
    replacement: () => "",
  })
  return service.turndown(html).trim()
}
