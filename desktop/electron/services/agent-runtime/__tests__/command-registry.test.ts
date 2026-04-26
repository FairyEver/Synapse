import type {
  AgentCommandEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import { describe, expect, it } from "vitest"

import {
  CustomCommandRegistry,
  expandCustomCommandPrompt,
} from "../command-registry"

describe("CustomCommandRegistry", () => {
  it("stores prompt and exec commands", async () => {
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const registry = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })

    await registry.addPrompt({ name: "Review", prompt: "Review {{args}}" })
    await registry.addExec({ name: "Build", exec: "pnpm build" })

    expect(await registry.resolve("review")).toEqual(expect.objectContaining({
      name: "review",
      kind: "prompt",
    }))
    expect(await registry.resolve("build")).toEqual(expect.objectContaining({
      name: "build",
      kind: "exec",
      adminOnly: true,
      allowedPlatforms: ["local-renderer"],
    }))
  })

  it("expands placeholders and appends args when no placeholders exist", () => {
    expect(expandCustomCommandPrompt({ prompt: "A {{1}} {{2*}} {{args}}" }, ["one", "two", "three"]))
      .toBe("A one two three one two three")
    expect(expandCustomCommandPrompt({ prompt: "Review" }, ["src/app.ts"]))
      .toBe("Review\n\nsrc/app.ts")
  })
})

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(): Promise<void> {}

  async list(): Promise<T[]> {
    return [...this.values.values()]
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({
      namespace: this.name,
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({
      namespace: this.name,
      kind: "remove",
      id,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const listener of this.listeners) listener(event)
  }
}

function fixedNow(): Date {
  return new Date("2026-04-26T00:00:00.000Z")
}

