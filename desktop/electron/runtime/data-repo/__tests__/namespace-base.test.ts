import { describe, expect, it, vi } from "vitest"
import {
  AbstractDataNamespace,
  type NamespaceBaseDeps,
  type DataChangeListener,
  BackupFormatError,
  EncryptionUnavailableError,
  InvalidNamespaceDataError,
  MigrationDowngradeError,
  MigrationFailedError,
  MissingMigrationError,
  NamespaceNotFoundError,
  DataRepositoryError,
} from "../index"

class TestNamespace<T extends { id: string }> extends AbstractDataNamespace<T> {
  private singleton: T | null = null
  private items = new Map<string, T>()

  constructor(deps: NamespaceBaseDeps<T>) {
    super(deps)
  }

  async getSingleton(): Promise<T | null> {
    return this.singleton ?? this.defaults?.() ?? null
  }
  async setSingleton(value: T): Promise<void> {
    const previous = this.singleton
    this.singleton = value
    this.emit({ kind: "replace", value, previous: previous ?? undefined })
  }
  async list(filter?: Partial<T>): Promise<T[]> {
    return this.applyFilter([...this.items.values()], filter)
  }
  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }
  async upsert(item: T & { id: string }): Promise<void> {
    const previous = this.items.get(item.id)
    this.items.set(item.id, item)
    this.emit({ kind: "upsert", id: item.id, value: item, previous })
  }
  async remove(id: string): Promise<void> {
    const previous = this.items.get(id)
    if (!previous) return
    this.items.delete(id)
    this.emit({ kind: "remove", id, previous })
  }

  // expose for tests
  getListenerCount(): number {
    return this.listeners.size
  }
}

interface User { id: string; name: string; role?: "admin" | "user" }

describe("DataRepository types + AbstractDataNamespace (T2.1)", () => {
  it("namespace exposes name, schemaVersion, backend", () => {
    const ns = new TestNamespace<User>({
      name: "users",
      schemaVersion: 1,
      backend: "json",
    })
    expect(ns.name).toBe("users")
    expect(ns.schemaVersion).toBe(1)
    expect(ns.backend).toBe("json")
  })

  it("singleton get/set roundtrips and emits a 'replace' change event", async () => {
    const ns = new TestNamespace<User>({ name: "u", schemaVersion: 1, backend: "json" })
    const events: Array<{ kind: string; value?: unknown; previous?: unknown }> = []
    ns.onChange((e) => events.push({ kind: e.kind, value: e.value, previous: e.previous }))
    expect(await ns.getSingleton()).toBeNull()
    await ns.setSingleton({ id: "1", name: "Ada" })
    expect(await ns.getSingleton()).toEqual({ id: "1", name: "Ada" })
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe("replace")
    expect(events[0]?.value).toEqual({ id: "1", name: "Ada" })
    expect(events[0]?.previous).toBeUndefined()
  })

  it("upsert/get/list/remove roundtrip and emit corresponding events", async () => {
    const ns = new TestNamespace<User>({ name: "u", schemaVersion: 1, backend: "json" })
    const events: Array<{ kind: string; id?: string }> = []
    ns.onChange((e) => events.push({ kind: e.kind, id: e.id }))

    await ns.upsert({ id: "u1", name: "Ada" })
    await ns.upsert({ id: "u2", name: "Bob", role: "admin" })
    expect(await ns.get("u1")).toEqual({ id: "u1", name: "Ada" })
    expect(await ns.list()).toHaveLength(2)
    expect(await ns.list({ role: "admin" })).toEqual([{ id: "u2", name: "Bob", role: "admin" }])

    await ns.remove("u1")
    expect(await ns.get("u1")).toBeNull()
    expect(await ns.list()).toHaveLength(1)
    expect(events.map((e) => e.kind)).toEqual(["upsert", "upsert", "remove"])
    expect(events[0]?.id).toBe("u1")
  })

  it("upsert emits previous when replacing an existing record", async () => {
    const ns = new TestNamespace<User>({ name: "u", schemaVersion: 1, backend: "json" })
    let captured: { previous?: unknown; value?: unknown } | null = null
    ns.onChange((e) => {
      if (e.kind === "upsert" && e.id === "u1" && e.previous) captured = e
    })
    await ns.upsert({ id: "u1", name: "Ada" })
    await ns.upsert({ id: "u1", name: "Adabel" })
    expect(captured).not.toBeNull()
    expect(captured!.previous).toEqual({ id: "u1", name: "Ada" })
    expect(captured!.value).toEqual({ id: "u1", name: "Adabel" })
  })

  it("listeners are isolated — one throwing does not block others", async () => {
    const ns = new TestNamespace<User>({ name: "u", schemaVersion: 1, backend: "json" })
    const seen: string[] = []
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    ns.onChange(() => {
      throw new Error("boom")
    })
    ns.onChange((e) => seen.push(e.kind))
    await ns.upsert({ id: "u1", name: "Ada" })
    expect(seen).toEqual(["upsert"])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("onChange returns an unsubscribe function that clears the slot", async () => {
    const ns = new TestNamespace<User>({ name: "u", schemaVersion: 1, backend: "json" })
    const listener: DataChangeListener<User> = () => {}
    const unsub = ns.onChange(listener)
    expect(ns.getListenerCount()).toBe(1)
    unsub()
    expect(ns.getListenerCount()).toBe(0)
  })

  it("defaults() seeds getSingleton when nothing has been written", async () => {
    const ns = new TestNamespace<User>({
      name: "u",
      schemaVersion: 1,
      backend: "json",
      defaults: () => ({ id: "default", name: "Anonymous" }),
    })
    expect(await ns.getSingleton()).toEqual({ id: "default", name: "Anonymous" })
  })

  it("error hierarchy exposes the documented names", () => {
    const cases: Array<[Error, string]> = [
      [new DataRepositoryError("base"), "DataRepositoryError"],
      [new NamespaceNotFoundError("users"), "NamespaceNotFoundError"],
      [new InvalidNamespaceDataError("users", "bad shape"), "InvalidNamespaceDataError"],
      [new MigrationDowngradeError("users", 2, 1), "MigrationDowngradeError"],
      [new MigrationFailedError("users", 0, 1, new Error("x")), "MigrationFailedError"],
      [new MissingMigrationError("users", 0, 2), "MissingMigrationError"],
      [new EncryptionUnavailableError(), "EncryptionUnavailableError"],
      [new BackupFormatError("missing 'format' field"), "BackupFormatError"],
    ]
    for (const [err, expected] of cases) {
      expect(err).toBeInstanceOf(DataRepositoryError)
      expect(err.name).toBe(expected)
    }
  })
})
