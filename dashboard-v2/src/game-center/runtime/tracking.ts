import type { Ref, RefCallback } from "react"

/** Browser diagnostics contain interaction metadata only, never form values or game payloads. */
export function track(details: { component: string; action: string; name?: string; eventKey?: string; [key: string]: unknown }): void {
  window.dispatchEvent(new CustomEvent("synapse:game-interaction", { detail: {
    component: details.component, action: details.action,
    eventKey: details.eventKey && /^[a-z][a-z0-9._-]{0,63}$/i.test(details.eventKey) ? details.eventKey : undefined,
  } }))
}
export function extractLabel(target: EventTarget | null, maxLen = 40): string | undefined {
  return target instanceof HTMLElement ? (target.getAttribute("aria-label") || target.textContent || "").trim().slice(0, maxLen) : undefined
}
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return value => { for (const ref of refs) { if (typeof ref === "function") ref(value); else if (ref) ref.current = value } }
}
export function debounce<Args extends unknown[]>(callback: (...args: Args) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: Args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay) }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}
