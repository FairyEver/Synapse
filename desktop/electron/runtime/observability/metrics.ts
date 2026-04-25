/**
 * Phase 0.6 — MetricsRegistry.
 * SPEC §15.4 / §15.6.
 *
 * Lightweight in-memory metrics. Phase 0 keeps it minimal; M3+ extends with
 * Prometheus exposition or OpenTelemetry SDK once the first consumer needs
 * cross-process aggregation.
 *
 * Naming convention follows SPEC §15.4 (synapse_*). The registry validates the
 * prefix to nudge consumers towards the convention without forcing it.
 */

export interface MetricLabels {
  readonly [key: string]: string
}

export interface Counter {
  inc(value?: number): void
  readonly value: number
}

export interface Gauge {
  set(value: number): void
  inc(delta?: number): void
  dec(delta?: number): void
  readonly value: number
}

export interface Histogram {
  observe(value: number): void
  /** Snapshot of count + sum + bucket distributions. */
  snapshot(): HistogramSnapshot
}

export interface HistogramSnapshot {
  readonly count: number
  readonly sum: number
  readonly buckets: ReadonlyArray<{ le: number; count: number }>
}

export interface MetricsSnapshot {
  readonly counters: Array<{ name: string; labels: MetricLabels; value: number }>
  readonly gauges: Array<{ name: string; labels: MetricLabels; value: number }>
  readonly histograms: Array<{ name: string; labels: MetricLabels; snapshot: HistogramSnapshot }>
}

export interface MetricsRegistry {
  counter(name: string, labels?: MetricLabels): Counter
  gauge(name: string, labels?: MetricLabels): Gauge
  histogram(name: string, labels?: MetricLabels, buckets?: number[]): Histogram
  toPrometheus(): string
  snapshot(): MetricsSnapshot
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

class CounterImpl implements Counter {
  private _value = 0
  inc(value = 1): void {
    this._value += value
  }
  get value(): number {
    return this._value
  }
}

class GaugeImpl implements Gauge {
  private _value = 0
  set(value: number): void {
    this._value = value
  }
  inc(delta = 1): void {
    this._value += delta
  }
  dec(delta = 1): void {
    this._value -= delta
  }
  get value(): number {
    return this._value
  }
}

class HistogramImpl implements Histogram {
  private count = 0
  private sum = 0
  private readonly bucketBounds: number[]
  private readonly bucketCounts: number[]

  constructor(buckets: number[] = DEFAULT_BUCKETS) {
    this.bucketBounds = [...buckets].sort((a, b) => a - b)
    this.bucketCounts = new Array(this.bucketBounds.length).fill(0)
  }

  observe(value: number): void {
    this.count++
    this.sum += value
    for (let i = 0; i < this.bucketBounds.length; i++) {
      if (value <= this.bucketBounds[i]!) this.bucketCounts[i]!++
    }
  }

  snapshot(): HistogramSnapshot {
    return {
      count: this.count,
      sum: this.sum,
      buckets: this.bucketBounds.map((le, i) => ({ le, count: this.bucketCounts[i]! })),
    }
  }
}

export interface MetricsRegistryOptions {
  /** Default true. Set to false to skip the synapse_* prefix check. */
  readonly enforceNamingConvention?: boolean
}

export class MetricsRegistryImpl implements MetricsRegistry {
  private readonly enforceNamingConvention: boolean
  private readonly counters = new Map<string, CounterImpl>()
  private readonly gauges = new Map<string, GaugeImpl>()
  private readonly histograms = new Map<string, HistogramImpl>()

  constructor(options: MetricsRegistryOptions = {}) {
    this.enforceNamingConvention = options.enforceNamingConvention ?? true
  }

  counter(name: string, labels: MetricLabels = {}): Counter {
    this.assertName(name)
    const key = makeKey(name, labels)
    let metric = this.counters.get(key)
    if (!metric) {
      metric = new CounterImpl()
      this.counters.set(key, metric)
    }
    return metric
  }

  gauge(name: string, labels: MetricLabels = {}): Gauge {
    this.assertName(name)
    const key = makeKey(name, labels)
    let metric = this.gauges.get(key)
    if (!metric) {
      metric = new GaugeImpl()
      this.gauges.set(key, metric)
    }
    return metric
  }

  histogram(name: string, labels: MetricLabels = {}, buckets?: number[]): Histogram {
    this.assertName(name)
    const key = makeKey(name, labels)
    let metric = this.histograms.get(key)
    if (!metric) {
      metric = new HistogramImpl(buckets)
      this.histograms.set(key, metric)
    }
    return metric
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: [...this.counters.entries()].map(([k, v]) => ({
        name: keyToName(k),
        labels: keyToLabels(k),
        value: v.value,
      })),
      gauges: [...this.gauges.entries()].map(([k, v]) => ({
        name: keyToName(k),
        labels: keyToLabels(k),
        value: v.value,
      })),
      histograms: [...this.histograms.entries()].map(([k, v]) => ({
        name: keyToName(k),
        labels: keyToLabels(k),
        snapshot: v.snapshot(),
      })),
    }
  }

  toPrometheus(): string {
    const lines: string[] = []
    const snap = this.snapshot()
    for (const c of snap.counters) {
      lines.push(`# TYPE ${c.name} counter`)
      lines.push(`${c.name}${formatLabels(c.labels)} ${c.value}`)
    }
    for (const g of snap.gauges) {
      lines.push(`# TYPE ${g.name} gauge`)
      lines.push(`${g.name}${formatLabels(g.labels)} ${g.value}`)
    }
    for (const h of snap.histograms) {
      lines.push(`# TYPE ${h.name} histogram`)
      for (const bucket of h.snapshot.buckets) {
        lines.push(
          `${h.name}_bucket${formatLabels({ ...h.labels, le: String(bucket.le) })} ${bucket.count}`,
        )
      }
      lines.push(`${h.name}_count${formatLabels(h.labels)} ${h.snapshot.count}`)
      lines.push(`${h.name}_sum${formatLabels(h.labels)} ${h.snapshot.sum}`)
    }
    return lines.join("\n") + "\n"
  }

  private assertName(name: string): void {
    if (!this.enforceNamingConvention) return
    if (!name.startsWith("synapse_")) {
      throw new Error(
        `Metric "${name}" must follow the synapse_* naming convention (SPEC §15.4)`,
      )
    }
  }
}

function makeKey(name: string, labels: MetricLabels): string {
  const sortedLabels = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("&")
  return `${name}|${sortedLabels}`
}

function keyToName(key: string): string {
  return key.split("|")[0]!
}

function keyToLabels(key: string): MetricLabels {
  const labelStr = key.split("|")[1] ?? ""
  if (!labelStr) return {}
  const out: Record<string, string> = {}
  for (const pair of labelStr.split("&")) {
    const [k, v] = pair.split("=")
    if (k && v !== undefined) out[k] = v
  }
  return out
}

function formatLabels(labels: MetricLabels): string {
  const entries = Object.keys(labels).sort()
  if (entries.length === 0) return ""
  const inner = entries.map((k) => `${k}="${escapeLabel(labels[k] ?? "")}"`).join(",")
  return `{${inner}}`
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
}

export function createMetricsRegistry(options?: MetricsRegistryOptions): MetricsRegistryImpl {
  return new MetricsRegistryImpl(options)
}
