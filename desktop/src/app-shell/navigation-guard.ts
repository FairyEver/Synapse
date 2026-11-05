import { createRendererLogger } from "@/app-shell/logging"

type NavigationGuard = () => boolean | Promise<boolean>
const guards = new Map<NavigationGuard, (() => boolean) | undefined>()
const logger = createRendererLogger("navigation")
let request = 0

export function registerNavigationGuard(guard: NavigationGuard, isBusy?: () => boolean): () => void {
  guards.set(guard, isBusy)
  return () => { guards.delete(guard); request++ }
}

export function isAppNavigationBusy(): boolean {
  return [...guards.values()].some(isBusy => isBusy?.())
}

/** Keep the current editor mounted until it confirms its content is safe. */
export async function runAppNavigation(navigate: () => void | Promise<void>): Promise<boolean> {
  try {
    // A save in flight must not invalidate the navigation it is waiting to finish.
    if (isAppNavigationBusy()) return false
    const current = ++request
    for (const guard of [...guards.keys()]) {
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
