/**
 * Phase 0.5 — RuntimeMode + bootstrap.
 * SPEC §15.3.
 *
 * `bootstrap("gui")` is what main.ts will call eventually (Phase 0.6 wires
 * everything end-to-end). `bootstrap("headless")` builds the same registry +
 * container set without creating any BrowserWindow; WindowManager.broadcast
 * degrades to a no-op.
 *
 * Phase 0.5 lands the contract + the GUI default. Headless wiring remains a
 * stub until M4+ implements GUI-less runtime support.
 */

import type { ServiceRegistry } from "./service-registry/types"
import type { ProjectContainerRegistry } from "./project-container/types"

export type RuntimeMode = "gui" | "headless"

export interface RuntimeContext {
  readonly mode: RuntimeMode
  readonly registry: ServiceRegistry
  readonly container: ProjectContainerRegistry
}

export interface BootstrapDeps {
  readonly registry: ServiceRegistry
  readonly container: ProjectContainerRegistry
}

export async function bootstrap(
  mode: RuntimeMode,
  deps: BootstrapDeps,
): Promise<RuntimeContext> {
  switch (mode) {
    case "gui":
      return { mode, registry: deps.registry, container: deps.container }
    case "headless":
      // Phase 0.5 publishes the contract; runtimes that need actual GUI-less
      // wiring will land when M4+ does headless.
      return { mode, registry: deps.registry, container: deps.container }
    default: {
      const exhaustive: never = mode
      throw new Error(`Unknown runtime mode: ${exhaustive as string}`)
    }
  }
}
