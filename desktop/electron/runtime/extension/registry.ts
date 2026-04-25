/**
 * Phase 0.6 — ExtensionRegistry + ExtensionPoint.
 * SPEC §15.1.
 *
 * The registry lets feature modules expose typed extension points (e.g.
 * "content.types", "editors", "connectors", "providers"); concrete
 * contributions register against a point. T6.10 migrates the existing
 * content-type / editor enums to use this.
 */

export interface ExtensionPoint<T> {
  readonly id: string
  register(contribution: T): () => void
  list(): readonly T[]
}

export interface ExtensionRegistry {
  definePoint<T>(id: string): ExtensionPoint<T>
  point<T>(id: string): ExtensionPoint<T> | null
  listPoints(): readonly string[]
}

class ExtensionPointImpl<T> implements ExtensionPoint<T> {
  readonly id: string
  private readonly contributions: T[] = []

  constructor(id: string) {
    this.id = id
  }

  register(contribution: T): () => void {
    this.contributions.push(contribution)
    return () => {
      const idx = this.contributions.indexOf(contribution)
      if (idx >= 0) this.contributions.splice(idx, 1)
    }
  }

  list(): readonly T[] {
    return this.contributions.slice()
  }
}

export class ExtensionRegistryImpl implements ExtensionRegistry {
  private readonly points = new Map<string, ExtensionPointImpl<unknown>>()

  definePoint<T>(id: string): ExtensionPoint<T> {
    const existing = this.points.get(id)
    if (existing) {
      return existing as ExtensionPoint<T>
    }
    const point = new ExtensionPointImpl<T>(id)
    this.points.set(id, point as ExtensionPointImpl<unknown>)
    return point
  }

  point<T>(id: string): ExtensionPoint<T> | null {
    return (this.points.get(id) ?? null) as ExtensionPoint<T> | null
  }

  listPoints(): readonly string[] {
    return [...this.points.keys()]
  }
}

export function createExtensionRegistry(): ExtensionRegistryImpl {
  return new ExtensionRegistryImpl()
}
