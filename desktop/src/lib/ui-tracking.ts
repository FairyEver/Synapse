import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("ui.tracking")

export type TrackAction =
  | "click"
  | "open"
  | "close"
  | "select"
  | "toggle"
  | "check"
  | "uncheck"
  | "focus"
  | "blur"
  | "expand"
  | "collapse"
  | "slide"
  | "hover"
  | "complete"
  | "change"

export type TrackDetails = {
  component: string
  name: string
  action: TrackAction
  value?: string | number | boolean | string[] | number[]
}

export function track(details: TrackDetails): void {
  logger.info(`${details.name}:${details.action}`, details)
}

export function extractLabel(el: EventTarget | null, maxLen = 40): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined

  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel) return ariaLabel.slice(0, maxLen)

  const title = el.getAttribute("title")
  if (title) return title.slice(0, maxLen)

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const placeholder = el.getAttribute("placeholder")
    if (placeholder) return placeholder.slice(0, maxLen)
    const name = el.getAttribute("name")
    if (name) return name.slice(0, maxLen)
  }

  const text = el.innerText?.trim()
  if (text) {
    const firstLine = text.split("\n")[0].trim()
    return firstLine.slice(0, maxLen) || undefined
  }

  return undefined
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

export function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node
    }
  }
}
