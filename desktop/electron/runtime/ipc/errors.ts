/**
 * Phase 0.3 — IPC runtime errors.
 * SPEC §6.
 *
 * SPEC §9 "禁止吞错": all IPC errors surface as { code, message, details?, retriable }
 * structured payloads on the renderer side. The classes here are the
 * server-side throwables; serialization happens in `validation.ts` /
 * `registry.ts` before the response is sent.
 */

export class IpcRuntimeError extends Error {
  readonly code: string
  readonly retriable: boolean
  readonly details?: Record<string, unknown>
  constructor(
    code: string,
    message: string,
    options: { retriable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options as ErrorOptions)
    this.name = "IpcRuntimeError"
    this.code = code
    this.retriable = options.retriable ?? false
    this.details = options.details
  }

  toJSON(): { code: string; message: string; details?: Record<string, unknown>; retriable: boolean } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retriable: this.retriable,
    }
  }
}

export class IpcValidationError extends IpcRuntimeError {
  constructor(channel: string, issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
    super(
      "ipc/validation",
      `Validation failed for "${channel}": ${issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`,
      { details: { channel, issues } },
    )
    this.name = "IpcValidationError"
  }
}

export class IpcChannelNotFoundError extends IpcRuntimeError {
  constructor(channel: string) {
    super("ipc/channel-not-found", `IPC channel "${channel}" is not registered`, {
      details: { channel },
    })
    this.name = "IpcChannelNotFoundError"
  }
}

export class IpcModuleAlreadyRegisteredError extends IpcRuntimeError {
  constructor(moduleId: string) {
    super(
      "ipc/module-already-registered",
      `IPC module "${moduleId}" is already registered`,
      { details: { moduleId } },
    )
    this.name = "IpcModuleAlreadyRegisteredError"
  }
}

export class IpcProtocolVersionMismatchError extends IpcRuntimeError {
  constructor(serverVersion: number, clientVersion: number) {
    super(
      "ipc/protocol-version-mismatch",
      `IPC protocol version mismatch: server=${serverVersion}, client=${clientVersion}. Renderer needs reload.`,
      {
        retriable: false,
        details: { serverVersion, clientVersion },
      },
    )
    this.name = "IpcProtocolVersionMismatchError"
  }
}
