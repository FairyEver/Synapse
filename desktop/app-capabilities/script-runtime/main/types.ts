import type {
  JsonObject,
  JsonValue,
  ScriptRuntimeErrorCode,
  ScriptRuntimeErrorReason,
} from "../shared/json"

export type ScriptRunLog = {
  readonly label: "stdout" | "stderr" | "console"
  readonly value: string
}

export type ScriptRunRequest = {
  readonly source: string
  readonly input: JsonObject
  readonly timeoutSeconds: number
  readonly abortSignal: AbortSignal
}

export type NodeScriptRunRequest = ScriptRunRequest & {
  readonly cwd: string
  readonly moduleMode: "commonjs" | "esm"
}

export type ScriptRunSuccess = {
  readonly status: "success"
  readonly result: JsonValue
  readonly logs: readonly ScriptRunLog[]
  readonly durationMs: number
  readonly exitCode?: number
}

export type ScriptRunFailure = {
  readonly status: "failed" | "timeout" | "cancelled"
  readonly code: ScriptRuntimeErrorCode
  readonly reason?: ScriptRuntimeErrorReason
  readonly error: string
  readonly logs: readonly ScriptRunLog[]
  readonly durationMs: number
  readonly exitCode?: number | null
}

export type ScriptRunOutcome = ScriptRunSuccess | ScriptRunFailure
