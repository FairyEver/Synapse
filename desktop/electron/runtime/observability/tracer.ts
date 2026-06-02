/**
 * Phase 0.6 — Tracer.
 * SPEC §15.4.
 *
 * Minimal span abstraction. Phase 0 keeps it in-memory; M3+ wires
 * OpenTelemetry SDK once cross-process tracing matters.
 */

export interface SpanContext {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
}

export type SpanStatus = "ok" | "error" | "unset"

export interface Span {
  readonly name: string
  readonly context: SpanContext
  setAttribute(key: string, value: unknown): void
  setStatus(status: SpanStatus, message?: string): void
  addEvent(name: string, attrs?: Record<string, unknown>): void
  end(): void
}

export interface FinishedSpan extends Span {
  readonly attributes: Readonly<Record<string, unknown>>
  readonly events: ReadonlyArray<{ name: string; timestamp: number; attrs?: Record<string, unknown> }>
  readonly status: SpanStatus
  readonly statusMessage?: string
  readonly startedAt: number
  readonly endedAt: number
  readonly durationMs: number
}

export interface Tracer {
  startSpan(name: string, parent?: SpanContext): Span
  /** Test/debug introspection. */
  finishedSpans(): readonly FinishedSpan[]
}

let nextId = 1
function genId(): string {
  return (nextId++).toString(36)
}

const MAX_FINISHED_SPANS = 1000

class SpanImpl implements Span {
  readonly name: string
  readonly context: SpanContext
  readonly startedAt: number
  endedAt: number = 0
  status: SpanStatus = "unset"
  statusMessage?: string
  readonly attributes: Record<string, unknown> = {}
  readonly events: Array<{ name: string; timestamp: number; attrs?: Record<string, unknown> }> = []
  private ended = false

  constructor(
    name: string,
    context: SpanContext,
    private readonly onEnd: (span: SpanImpl) => void,
  ) {
    this.name = name
    this.context = context
    this.startedAt = Date.now()
  }

  setAttribute(key: string, value: unknown): void {
    if (this.ended) return
    this.attributes[key] = value
  }

  setStatus(status: SpanStatus, message?: string): void {
    if (this.ended) return
    this.status = status
    this.statusMessage = message
  }

  addEvent(name: string, attrs?: Record<string, unknown>): void {
    if (this.ended) return
    this.events.push({ name, timestamp: Date.now(), attrs })
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.endedAt = Date.now()
    this.onEnd(this)
  }
}

export class TracerImpl implements Tracer {
  private readonly finished: FinishedSpan[] = []

  startSpan(name: string, parent?: SpanContext): Span {
    const traceId = parent?.traceId ?? genId()
    const spanId = genId()
    const ctx: SpanContext = {
      traceId,
      spanId,
      parentSpanId: parent?.spanId,
    }
    const impl = new SpanImpl(name, ctx, (span) => {
      if (this.finished.length >= MAX_FINISHED_SPANS) {
        this.finished.splice(0, this.finished.length - MAX_FINISHED_SPANS + 1)
      }
      this.finished.push({
        name: span.name,
        context: span.context,
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        durationMs: span.endedAt - span.startedAt,
        attributes: span.attributes,
        events: span.events,
        status: span.status,
        statusMessage: span.statusMessage,
        setAttribute: () => {},
        setStatus: () => {},
        addEvent: () => {},
        end: () => {},
      })
    })
    return impl
  }

  finishedSpans(): readonly FinishedSpan[] {
    return this.finished.slice()
  }
}

export function createTracer(): TracerImpl {
  return new TracerImpl()
}
