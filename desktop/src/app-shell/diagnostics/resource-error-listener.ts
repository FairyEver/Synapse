import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const RESOURCE_TAGS = new Set(["IMG", "SCRIPT", "LINK"])

function getResourceName(src: string): string {
  if (src.startsWith("data:")) {
    return "data:..."
  }

  return src.split("/").pop() ?? src
}

export function installResourceErrorListener(logger: RendererLogger): () => void {
  const handler = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!RESOURCE_TAGS.has(target.tagName)) return

    const tag = target.tagName.toLowerCase()
    const src =
      target.getAttribute("src") ||
      target.getAttribute("href") ||
      "(unknown)"
    const resourceName = getResourceName(src)

    guardedLog(logger, "error", `资源加载失败 <${tag} src="${resourceName}">`, {
      tag,
      src: resourceName,
      timestamp: new Date().toISOString(),
    })
  }

  document.addEventListener("error", handler, true)

  return () => {
    document.removeEventListener("error", handler, true)
  }
}
