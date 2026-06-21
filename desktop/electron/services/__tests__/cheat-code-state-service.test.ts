import { describe, expect, it, vi } from "vitest"

import { CheatCodeStateService } from "../cheat-code-state-service"
import type { DataChangeListener, DataNamespace } from "../../runtime/data-repo"
import type { CheatCodeStatesEntryV1 } from "../../runtime/data-repo/schemas"
import type { EventBus } from "../../runtime/event-bus"

type TestEventBus = Pick<EventBus, "emit"> & {
  readonly emit: ReturnType<typeof vi.fn>
}

describe("CheatCodeStateService", () => {
  it("returns canonical false values for missing requested states", async () => {
    const logger = createLoggerHarness()
    const service = createService({ logger })

    await expect(service.getStates(["settings:missing"])).resolves.toEqual({
      "settings:missing": false,
    })
    expect(logger.info).toHaveBeenCalledWith("Cheat code states read.", {
      requestedCount: 1,
      allStates: false,
    })
  })

  it("sets and toggles state through the DataRepository namespace", async () => {
    const service = createService()

    await expect(service.setState({ name: "settings:test-state", active: true })).resolves.toEqual({
      active: true,
      name: "settings:test-state",
    })
    await expect(service.toggleState("settings:test-state")).resolves.toEqual({
      active: false,
      name: "settings:test-state",
    })

    await expect(service.getStates(["settings:test-state"])).resolves.toEqual({
      "settings:test-state": false,
    })
  })

  it("serializes concurrent toggles for the same state name", async () => {
    const service = createService()

    await Promise.all([
      service.toggleState("settings:test-state"),
      service.toggleState("settings:test-state"),
    ])

    await expect(service.getStates(["settings:test-state"])).resolves.toEqual({
      "settings:test-state": false,
    })
  })

  it("emits state change events without exposing input sequences", async () => {
    const eventBus = { emit: vi.fn() } as unknown as TestEventBus
    const service = createService({ eventBus })

    await service.toggleState("settings:test-state")

    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "cheat-code",
      payload: {
        active: true,
        name: "settings:test-state",
      },
      type: "cheat-code.stateChanged",
    }))
    expect(JSON.stringify(eventBus.emit.mock.calls)).not.toContain("sequence")
  })

  it("logs persisted state changes without exposing input sequences", async () => {
    const logger = createLoggerHarness()
    const service = createService({ logger })

    await service.setState({ name: "settings:test-state", active: true })
    await service.setState({ name: "settings:test-state", active: true })

    expect(logger.info).toHaveBeenCalledWith("Cheat code state persisted.", {
      name: "settings:test-state",
      active: true,
      previousActive: false,
    })
    expect(logger.info).toHaveBeenCalledWith("Cheat code state unchanged.", {
      name: "settings:test-state",
      active: true,
    })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("sequence")
  })

  it("logs persistence failures before rethrowing", async () => {
    const logger = createLoggerHarness()
    const service = createService({
      logger,
      states: new FailingNamespace(),
    })

    await expect(service.setState({ name: "settings:test-state", active: true }))
      .rejects.toThrow("write failed")

    expect(logger.error).toHaveBeenCalledWith("Cheat code state persist failed.", {
      name: "settings:test-state",
      active: true,
      previousActive: false,
      errorName: "Error",
      errorMessage: "write failed",
      errorLength: 12,
    })
  })
})

function createService(options: {
  readonly eventBus?: Pick<EventBus, "emit">
  readonly logger?: ReturnType<typeof createLoggerHarness>
  readonly states?: DataNamespace<CheatCodeStatesEntryV1>
} = {}): CheatCodeStateService {
  return new CheatCodeStateService({
    eventBus: options.eventBus,
    logger: options.logger,
    states: options.states ?? new MemoryNamespace(),
  })
}

function createLoggerHarness() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  }
}

class MemoryNamespace implements DataNamespace<CheatCodeStatesEntryV1> {
  readonly name = "cheat-code.states"
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private value: CheatCodeStatesEntryV1 | null = null

  async getSingleton(): Promise<CheatCodeStatesEntryV1 | null> {
    return this.value
  }

  async setSingleton(value: CheatCodeStatesEntryV1): Promise<void> {
    this.value = value
  }

  async list(): Promise<CheatCodeStatesEntryV1[]> {
    return this.value ? [this.value] : []
  }

  async count(): Promise<number> {
    return this.value ? 1 : 0
  }

  async get(): Promise<CheatCodeStatesEntryV1 | null> {
    return this.value
  }

  async upsert(item: CheatCodeStatesEntryV1 & { id: string }): Promise<void> {
    this.value = item
  }

  async remove(): Promise<void> {
    this.value = null
  }

  onChange(_listener: DataChangeListener<CheatCodeStatesEntryV1>): () => void {
    return () => {}
  }
}

class FailingNamespace extends MemoryNamespace {
  override async setSingleton(_value: CheatCodeStatesEntryV1): Promise<void> {
    throw new Error("write failed")
  }
}
