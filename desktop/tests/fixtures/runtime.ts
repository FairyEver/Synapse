/**
 * Phase 0.6 — Shared test fixture utilities.
 *
 * Used by tests under `tests/{unit,ipc,perf,fuzz}/` to spin up runtime
 * infrastructure without booting Electron.
 */

import { createServiceRegistry } from "../../electron/runtime/service-registry"
import { createEventBus } from "../../electron/runtime/event-bus"
import { createDataRepository } from "../../electron/runtime/data-repo"
import {
  createProjectContainerRegistry,
  type ProjectContainerRegistry,
} from "../../electron/runtime/project-container"
import { createInMemoryHarness, type InMemoryIpcHarness } from "../../electron/runtime/ipc"
import { createNoopLogger } from "../../electron/runtime/lib/test-helpers"

export interface RuntimeFixture {
  readonly serviceRegistry: ReturnType<typeof createServiceRegistry>
  readonly eventBus: ReturnType<typeof createEventBus>
  readonly dataRepo: ReturnType<typeof createDataRepository>
  readonly container: ProjectContainerRegistry
  readonly ipc: InMemoryIpcHarness
}

export function createRuntimeFixture(): RuntimeFixture {
  const serviceRegistry = createServiceRegistry()
  const eventBus = createEventBus({ defaultBackpressure: "drop-newest" })
  const dataRepo = createDataRepository()
  const container = createProjectContainerRegistry({
    globalRegistry: serviceRegistry,
    globalEventBus: eventBus,
    globalDataRepo: dataRepo,
    buildLogger: () => createNoopLogger(),
  })
  const ipc = createInMemoryHarness()
  return { serviceRegistry, eventBus, dataRepo, container, ipc }
}

/** Convenience: a noop StructuredLogger usable in any test. */
export const testLogger = createNoopLogger()
