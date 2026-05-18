/**
 * Phase 0.6 — Integration test.
 *
 * SPEC §9 verification:
 *   - StructuredLogger emits records to a sink.
 *   - MetricsRegistry counts and exports.
 *   - HealthCheckAggregator + DiagnosticsCollector compose cleanly.
 *   - PermissionGuard + AuditSink work together.
 *   - TaskQueue + RateLimiter + CircuitBreaker compose for an Agent-style workflow.
 *   - ExtensionRegistry returns content types registered by bootstrap.
 *   - i18n + theme placeholders are wired.
 */

import { describe, expect, it } from "vitest"
import {
  ArraySink,
  createLogger,
} from "../../electron/runtime/logging"
import {
  createMetricsRegistry,
  createHealthCheckAggregator,
  createDiagnosticsCollector,
} from "../../electron/runtime/observability"
import {
  InMemoryAuditSink,
  createPermissionGuard,
} from "../../electron/runtime/security"
import {
  createCircuitBreaker,
  createRateLimiter,
  createTaskQueue,
} from "../../electron/runtime/scheduling"
import { createExtensionRegistry } from "../../electron/runtime/extension"
import { registerCoreExtensions, EXTENSION_POINT_IDS } from "../../electron/bootstrap/extensions"
import {
  InMemoryI18nProvider,
  setI18nProvider,
  t,
} from "../../src/runtime/i18n"

describe("Phase 0.6 integration (T6.17)", () => {
  it("logger writes to sink, metrics counts, diagnostics bundles them", async () => {
    const sink = new ArraySink()
    const logger = createLogger({ module: "agent.runtime", sink, minLevel: "debug" })
    const metrics = createMetricsRegistry()
    const health = createHealthCheckAggregator()
    health.register("agent.runtime", () => ({ status: "healthy" }))

    const agentStarts = metrics.counter("synapse_agent_session_started_total")
    logger.info("Session starting", { sessionId: "s1" })
    agentStarts.inc()

    const diag = createDiagnosticsCollector({
      recentLogs: () => sink.records,
      inspectServices: () => [],
      inspectDataRepo: () => [],
      metricsSnapshot: () => metrics.snapshot(),
      checkHealth: () => health.checkAll(),
      listProjectContainers: () => [],
    })
    const artifact = await diag.collect()
    expect(artifact.metrics.counters[0]?.value).toBe(1)
    expect(artifact.health.status).toBe("healthy")
    expect(artifact.recentLogs[0]?.message).toBe("Session starting")
  })

  it("PermissionGuard allows the user, AuditSink records the outcome", async () => {
    const guard = createPermissionGuard()
    const audit = new InMemoryAuditSink()
    const decision = await guard.check({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/x",
      context: {},
    })
    audit.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/x",
      outcome: decision.allowed ? "allowed" : "denied",
    })
    expect(decision.allowed).toBe(true)
    expect(audit.list()).toHaveLength(1)
    expect(audit.list()[0]?.outcome).toBe("allowed")
  })

  it("TaskQueue + RateLimiter + CircuitBreaker compose for an Agent-like flow", async () => {
    const queue = createTaskQueue({ concurrency: 2 })
    const limiter = createRateLimiter()
    limiter.configure("anthropic", { capacity: 3, refillPerSecond: 100 })
    const breaker = createCircuitBreaker()
    breaker.configure("anthropic", { failureThreshold: 5, cooldownMs: 1000 })

    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        queue.enqueue({
          id: `req-${n}`,
          run: async () => {
            await limiter.acquire("anthropic")
            return await breaker.execute("anthropic", async () => `pong-${n}`)
          },
        }),
      ),
    )
    expect(results.sort()).toEqual(["pong-1", "pong-2", "pong-3"])
  })

  it("registerCoreExtensions reads CONTENT_TYPE_DEFINITIONS via the registry", () => {
    const registry = createExtensionRegistry()
    registerCoreExtensions(registry)
    const point = registry.point<{ id: string; displayName: string }>(EXTENSION_POINT_IDS.contentTypes)
    expect(point).not.toBeNull()
    expect(point!.list().length).toBeGreaterThan(0)
    for (const entry of point!.list()) {
      expect(typeof entry.id).toBe("string")
      expect(typeof entry.displayName).toBe("string")
    }
  })

  it("i18n placeholder behaves as expected", () => {
    const i18n = new InMemoryI18nProvider()
    i18n.registerDictionary("zh-CN", { greeting: "你好，{name}" })
    setI18nProvider(i18n)
    expect(t("greeting", { name: "Ada" })).toBe("你好，Ada")
    expect(t("missing.key")).toBe("missing.key")
  })
})
