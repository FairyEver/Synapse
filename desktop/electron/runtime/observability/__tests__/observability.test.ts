import { describe, expect, it } from "vitest"
import {
  createMetricsRegistry,
  createTracer,
  createHealthCheckAggregator,
  createDiagnosticsCollector,
} from "../index"

describe("MetricsRegistry (T6.2)", () => {
  it("counter inc / value", () => {
    const reg = createMetricsRegistry()
    const c = reg.counter("synapse_test_total")
    c.inc()
    c.inc(5)
    expect(c.value).toBe(6)
  })

  it("gauge set / inc / dec", () => {
    const reg = createMetricsRegistry()
    const g = reg.gauge("synapse_test_gauge")
    g.set(10)
    g.inc(5)
    g.dec(2)
    expect(g.value).toBe(13)
  })

  it("histogram observe + snapshot", () => {
    const reg = createMetricsRegistry()
    const h = reg.histogram("synapse_test_duration", {}, [0.1, 0.5, 1])
    h.observe(0.05)
    h.observe(0.6)
    h.observe(2)
    const s = h.snapshot()
    expect(s.count).toBe(3)
    expect(s.sum).toBe(2.65)
    expect(s.buckets.find((b) => b.le === 0.1)?.count).toBe(1)
  })

  it("enforces synapse_* naming convention by default", () => {
    const reg = createMetricsRegistry()
    expect(() => reg.counter("bad_name")).toThrow(/synapse_/)
  })

  it("toPrometheus emits counter + gauge + histogram exposition", () => {
    const reg = createMetricsRegistry()
    reg.counter("synapse_a").inc(2)
    reg.gauge("synapse_b").set(5)
    const text = reg.toPrometheus()
    expect(text).toContain("# TYPE synapse_a counter")
    expect(text).toContain("synapse_a 2")
    expect(text).toContain("# TYPE synapse_b gauge")
    expect(text).toContain("synapse_b 5")
  })

  it("labels make distinct counters", () => {
    const reg = createMetricsRegistry()
    const a = reg.counter("synapse_x", { route: "/a" })
    const b = reg.counter("synapse_x", { route: "/b" })
    a.inc()
    b.inc(3)
    expect(a.value).toBe(1)
    expect(b.value).toBe(3)
  })
})

describe("Tracer (T6.3)", () => {
  it("startSpan + end + finishedSpans round-trips", () => {
    const tracer = createTracer()
    const span = tracer.startSpan("op")
    span.setAttribute("user", "ada")
    span.addEvent("step.a", { ok: true })
    span.setStatus("ok")
    span.end()
    const finished = tracer.finishedSpans()
    expect(finished).toHaveLength(1)
    expect(finished[0]?.name).toBe("op")
    expect(finished[0]?.attributes.user).toBe("ada")
    expect(finished[0]?.status).toBe("ok")
    expect(finished[0]?.events.find((e) => e.name === "step.a")?.attrs?.ok).toBe(true)
    expect(finished[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("child span inherits traceId from parent", () => {
    const tracer = createTracer()
    const parent = tracer.startSpan("parent")
    const child = tracer.startSpan("child", parent.context)
    expect(child.context.traceId).toBe(parent.context.traceId)
    expect(child.context.parentSpanId).toBe(parent.context.spanId)
    child.end()
    parent.end()
  })

  it("setAttribute / setStatus / addEvent are no-ops after end()", () => {
    const tracer = createTracer()
    const span = tracer.startSpan("x")
    span.end()
    span.setAttribute("late", "value")
    span.setStatus("error")
    span.addEvent("late-event")
    expect(tracer.finishedSpans()[0]?.attributes.late).toBeUndefined()
    expect(tracer.finishedSpans()[0]?.status).toBe("unset")
  })

  it("keeps only the most recent finished spans", () => {
    const tracer = createTracer()

    for (let index = 0; index < 1005; index += 1) {
      tracer.startSpan(`span-${index}`).end()
    }

    const finished = tracer.finishedSpans()
    expect(finished).toHaveLength(1000)
    expect(finished[0]?.name).toBe("span-5")
    expect(finished.at(-1)?.name).toBe("span-1004")
  })
})

describe("HealthCheckAggregator (T6.4)", () => {
  it("checkAll aggregates the worst component status", async () => {
    const agg = createHealthCheckAggregator()
    agg.register("a", () => ({ status: "healthy" }))
    agg.register("b", () => ({ status: "degraded", message: "slow" }))
    agg.register("c", () => ({ status: "healthy" }))
    const result = await agg.checkAll()
    expect(result.status).toBe("degraded")
    expect(result.components.b?.message).toBe("slow")
  })

  it("any unhealthy component bumps overall to unhealthy", async () => {
    const agg = createHealthCheckAggregator()
    agg.register("a", () => ({ status: "degraded" }))
    agg.register("b", () => ({ status: "unhealthy" }))
    expect((await agg.checkAll()).status).toBe("unhealthy")
  })

  it("thrown checks become unhealthy with the error message", async () => {
    const agg = createHealthCheckAggregator()
    agg.register("a", () => {
      throw new Error("DB down")
    })
    const result = await agg.checkAll()
    expect(result.components.a?.status).toBe("unhealthy")
    expect(result.components.a?.message).toBe("DB down")
  })

  it("rejects duplicate check ids", () => {
    const agg = createHealthCheckAggregator()
    agg.register("a", () => ({ status: "healthy" }))
    expect(() => agg.register("a", () => ({ status: "healthy" }))).toThrow(/already registered/)
  })

  it("returned unsubscriber removes the check", async () => {
    const agg = createHealthCheckAggregator()
    const unsub = agg.register("a", () => ({ status: "unhealthy" }))
    unsub()
    const result = await agg.checkAll()
    expect(result.status).toBe("healthy")
    expect(Object.keys(result.components)).toEqual([])
  })
})

describe("DiagnosticsCollector (T6.5)", () => {
  it("collect() bundles inspect/metrics/health/logs into a single artifact", async () => {
    const reg = createMetricsRegistry()
    reg.counter("synapse_x").inc(2)
    const agg = createHealthCheckAggregator()
    agg.register("a", () => ({ status: "healthy" }))

    const collector = createDiagnosticsCollector({
      recentLogs: () => [
        {
          timestamp: "2026-04-25T00:00:00Z",
          level: "info",
          module: "x",
          message: "hello",
          context: { token: "secret-value" },
        },
      ],
      inspectServices: () => [
        {
          id: "core.config",
          status: "running",
          criticality: "fatal",
          dependsOn: [],
          startAfter: [],
          runIn: "main",
        },
      ],
      inspectDataRepo: () => [
        { namespace: "core.config", backend: "json", schemaVersion: 1 },
      ],
      metricsSnapshot: () => reg.snapshot(),
      checkHealth: () => agg.checkAll(),
      listProjectContainers: () => [],
    })

    const artifact = await collector.collect()
    expect(artifact.system.pid).toBe(process.pid)
    expect(artifact.services).toHaveLength(1)
    expect(artifact.metrics.counters[0]?.value).toBe(2)
    expect(artifact.health.status).toBe("healthy")
    // Default redact replaces values for keys matching /key|token|secret|password/.
    expect(artifact.recentLogs[0]?.context?.token).toBe("[REDACTED]")
  })

  it("redacts recent log error messages and stacks in diagnostics artifacts", async () => {
    const reg = createMetricsRegistry()
    const agg = createHealthCheckAggregator()
    const collector = createDiagnosticsCollector({
      recentLogs: () => [
        {
          timestamp: "2026-04-25T00:00:00Z",
          level: "error",
          module: "agent-runtime",
          message: "sdk failed",
          context: { conversationId: "conv-1" },
          error: {
            name: "Error",
            message: "token=sk-secret failed in /Users/liyang/private/repo",
            stack: "Error: token=sk-secret\n    at /Users/liyang/private/repo/index.ts:1:1",
          },
        },
      ],
      inspectServices: () => [],
      inspectDataRepo: () => [],
      metricsSnapshot: () => reg.snapshot(),
      checkHealth: () => agg.checkAll(),
      listProjectContainers: () => [],
    })

    const artifact = await collector.collect()
    const error = artifact.recentLogs[0]?.error
    const serialized = JSON.stringify(artifact.recentLogs)

    expect(error).toEqual({
      name: "Error",
      message: "[REDACTED 52 chars]",
      stack: "[REDACTED 69 chars]",
    })
    expect(serialized).not.toContain("sk-secret")
    expect(serialized).not.toContain("/Users/liyang/private")
  })
})
