/**
 * Phase 0.1 — ServiceRegistry error types.
 * SPEC §4.
 */

export class ServiceRegistryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined)
    this.name = "ServiceRegistryError"
  }
}

export class CircularDependencyError extends ServiceRegistryError {
  readonly cycle: readonly string[]
  constructor(cycle: readonly string[]) {
    super(`Circular dependency detected: ${cycle.join(" -> ")}`)
    this.name = "CircularDependencyError"
    this.cycle = cycle
  }
}

export class UnknownDependencyError extends ServiceRegistryError {
  readonly serviceId: string
  readonly missingId: string
  constructor(serviceId: string, missingId: string) {
    super(`Service "${serviceId}" depends on unknown service "${missingId}"`)
    this.name = "UnknownDependencyError"
    this.serviceId = serviceId
    this.missingId = missingId
  }
}

export class DuplicateServiceError extends ServiceRegistryError {
  readonly serviceId: string
  constructor(serviceId: string) {
    super(`Service "${serviceId}" already registered`)
    this.name = "DuplicateServiceError"
    this.serviceId = serviceId
  }
}

export class ServiceNotFoundError extends ServiceRegistryError {
  readonly serviceId: string
  constructor(serviceId: string) {
    super(`Service "${serviceId}" not found`)
    this.name = "ServiceNotFoundError"
    this.serviceId = serviceId
  }
}

export class ServiceNotRunningError extends ServiceRegistryError {
  readonly serviceId: string
  readonly currentStatus: string
  constructor(serviceId: string, currentStatus: string) {
    super(`Service "${serviceId}" is not running (status=${currentStatus})`)
    this.name = "ServiceNotRunningError"
    this.serviceId = serviceId
    this.currentStatus = currentStatus
  }
}

export class FatalServiceFailureError extends ServiceRegistryError {
  readonly serviceId: string
  readonly stage: "create" | "start"
  constructor(serviceId: string, stage: "create" | "start", cause: unknown) {
    super(`Fatal service "${serviceId}" failed during ${stage}`, { cause })
    this.name = "FatalServiceFailureError"
    this.serviceId = serviceId
    this.stage = stage
  }
}

export class ServiceStopTimeoutError extends ServiceRegistryError {
  readonly serviceId: string
  readonly timeoutMs: number
  constructor(serviceId: string, timeoutMs: number) {
    super(`Service "${serviceId}" stop timed out after ${timeoutMs}ms`)
    this.name = "ServiceStopTimeoutError"
    this.serviceId = serviceId
    this.timeoutMs = timeoutMs
  }
}
