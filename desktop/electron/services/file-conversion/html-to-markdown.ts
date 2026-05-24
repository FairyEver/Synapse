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
  return service.turndown(html).trim()
}
