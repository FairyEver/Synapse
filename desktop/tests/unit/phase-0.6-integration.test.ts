/**
 * Phase 0.6 — Integration test.
 *
 * SPEC §9 verification:
 *   - StructuredLogger emits records to a sink.
 *   - MetricsRegistry counts and exports.
 *   - HealthCheckAggregator + DiagnosticsCollector compose cleanly.
 *   - PermissionGuard + AuditSink work together.
 *   - ExtensionRegistry returns content types registered by bootstrap.
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
import { createExtensionRegistry } from "../../electron/runtime/extension"
import { registerCoreExtensions, EXTENSION_POINT_IDS } from "../../electron/bootstrap/extensions"

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

})
