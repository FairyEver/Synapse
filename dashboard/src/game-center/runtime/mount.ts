import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
// Vite may execute both a stale entry and its timestamped replacement during navigation.
const roots = new WeakMap<HTMLElement, Root>()
export function mountGameRoot(container: HTMLElement, children: ReactNode): Root {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  root.render(children)
  return root
}
