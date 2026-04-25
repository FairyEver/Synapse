/**
 * Phase 0.6 — HealthCheckAggregator.
 * SPEC §15.4.
 */

export type HealthLevel = "healthy" | "degraded" | "unhealthy"

export interface ComponentHealth {
  readonly status: HealthLevel
  readonly message?: string
  readonly details?: Record<string, unknown>
}

export interface OverallHealth {
  readonly status: HealthLevel
  readonly components: Record<string, ComponentHealth>
  readonly timestamp: string
}

export type HealthCheck = () => Promise<ComponentHealth> | ComponentHealth

export interface HealthCheckAggregator {
  register(componentId: string, check: HealthCheck): () => void
  checkAll(): Promise<OverallHealth>
}

export class HealthCheckAggregatorImpl implements HealthCheckAggregator {
  private readonly checks = new Map<string, HealthCheck>()

  register(componentId: string, check: HealthCheck): () => void {
    if (this.checks.has(componentId)) {
      throw new Error(`Health check "${componentId}" already registered`)
    }
    this.checks.set(componentId, check)
    return () => this.checks.delete(componentId)
  }

  async checkAll(): Promise<OverallHealth> {
    const components: Record<string, ComponentHealth> = {}
    let worst: HealthLevel = "healthy"
    for (const [id, check] of this.checks) {
      try {
        const result = await Promise.resolve(check())
        components[id] = result
        if (result.status === "unhealthy") worst = "unhealthy"
        else if (result.status === "degraded" && worst !== "unhealthy") worst = "degraded"
      } catch (err) {
        components[id] = {
          status: "unhealthy",
          message: err instanceof Error ? err.message : String(err),
        }
        worst = "unhealthy"
      }
    }
    return {
      status: worst,
      components,
      timestamp: new Date().toISOString(),
    }
  }
}

export function createHealthCheckAggregator(): HealthCheckAggregatorImpl {
  return new HealthCheckAggregatorImpl()
}
