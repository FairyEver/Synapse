import { createRendererLogger } from "@/app-shell/logging"

type NavigationGuard = () => boolean | Promise<boolean>
const guards = new Set<NavigationGuard>()
const logger = createRendererLogger("navigation")
let request = 0

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.add(guard)
  return () => { guards.delete(guard); request++ }
}

/** Keep the current editor mounted until it confirms its content is safe. */
export async function runAppNavigation(navigate: () => void | Promise<void>): Promise<boolean> {
  const current = ++request
  try {
    for (const guard of [...guards]) {
      const result = guard()
      if (!(typeof result === "boolean" ? result : await result) || request !== current) return false
    }
    if (request !== current) return false
    await navigate()
    return true
  } catch (error) {
    logger.error("Navigation was blocked by an editor or failed action.", error)
    return false
  }
}
