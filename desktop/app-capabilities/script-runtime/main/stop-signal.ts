import { ScriptRuntimeError } from "../shared/json"

export type ScriptStopCode = "TIMEOUT" | "CANCELLED"

type OperationResult<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "stopped"; readonly code: ScriptStopCode }

export class ScriptStopSignal {
  private resolveStop!: (code: ScriptStopCode) => void
  private stopCode: ScriptStopCode | undefined

  readonly promise = new Promise<ScriptStopCode>((resolve) => {
    this.resolveStop = resolve
  })

  get code(): ScriptStopCode | undefined {
    return this.stopCode
  }

  request(code: ScriptStopCode): boolean {
    if (this.stopCode) return false
    this.stopCode = code
    this.resolveStop(code)
    return true
  }

  throwIfStopped(): void {
    if (!this.stopCode) return
    throw stopError(this.stopCode)
  }

  async race<T>(
    start: () => T | PromiseLike<T>,
    onLateValue?: (value: T) => void,
    onStopped?: () => void,
  ): Promise<T> {
    this.throwIfStopped()

    const operation = Promise.resolve(start())

    const observed: Promise<OperationResult<T>> = operation.then(
      (value): OperationResult<T> => {
        if (this.stopCode) {
          onLateValue?.(value)
          return { kind: "stopped", code: this.stopCode }
        }
        return { kind: "value", value }
      },
      (error): OperationResult<T> => this.stopCode
        ? { kind: "stopped", code: this.stopCode }
        : { kind: "error", error },
    )
    const winner = await Promise.race<OperationResult<T>>([
      observed,
      this.promise.then((code) => ({ kind: "stopped", code })),
    ])

    if (winner.kind === "stopped") {
      onStopped?.()
      throw stopError(winner.code)
    }
    if (winner.kind === "error") throw winner.error
    return winner.value
  }
}

function stopError(code: ScriptStopCode): ScriptRuntimeError {
  return code === "TIMEOUT"
    ? new ScriptRuntimeError("TIMEOUT", "Script execution timed out.")
    : new ScriptRuntimeError("CANCELLED", "Script execution was cancelled.")
}
