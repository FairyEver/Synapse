type CacheResult<T> = { readonly value: T; readonly status: "hit" | "shared" | "computed" }

/** Only caches permission-independent computations; callers must authorize and project their own DTOs. */
export class AnnotationComputationCache<T> {
  private readonly values = new Map<string, { value: T; bytes: number }>()
  private readonly pending = new Map<string, Promise<T>>()
  private bytes = 0

  constructor(private readonly options: {
    readonly maxEntries: number
    readonly maxBytes: number
    readonly sizeOf: (value: T) => number
  }) {}

  async get(key: string, load: () => Promise<T>, keyForValue: (value: T) => string = () => key): Promise<CacheResult<T>> {
    const cached = this.values.get(key)
    if (cached) {
      this.values.delete(key)
      this.values.set(key, cached)
      return { value: cached.value, status: "hit" }
    }
    return shareAnnotationComputation(this.pending, key, async () => {
      const value = await load()
      // A persisted revision can change between lookup and load. Retain only under the loaded identity.
      const retainedKey = keyForValue(value)
      const bytes = this.options.sizeOf(value) + retainedKey.length * 2
      if (bytes <= this.options.maxBytes) {
        const previous = this.values.get(retainedKey)
        if (previous) this.bytes -= previous.bytes
        this.values.delete(retainedKey)
        this.values.set(retainedKey, { value, bytes })
        this.bytes += bytes
        while (this.values.size > this.options.maxEntries || this.bytes > this.options.maxBytes) {
          const oldest = this.values.keys().next().value!
          this.bytes -= this.values.get(oldest)!.bytes
          this.values.delete(oldest)
        }
      }
      return value
    }, this.options.maxEntries)
  }

  peek(key: string): T | undefined {
    const cached = this.values.get(key)
    if (!cached) return undefined
    this.values.delete(key)
    this.values.set(key, cached)
    return cached.value
  }
}

export async function shareAnnotationComputation<T>(
  pending: Map<string, Promise<T>>, key: string, load: () => Promise<T>, maximumPending = 64,
): Promise<{ readonly value: T; readonly status: "shared" | "computed" }> {
  const existing = pending.get(key)
  if (existing) return { value: await existing, status: "shared" }
  const work = Promise.resolve().then(load)
  // Overflow computes normally without retaining unbounded in-flight bookkeeping.
  if (pending.size < maximumPending) pending.set(key, work)
  try { return { value: await work, status: "computed" } }
  finally { if (pending.get(key) === work) pending.delete(key) }
}
