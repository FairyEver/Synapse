import { BuiltinToolError } from "./errors"
import { getBuiltinToolDescriptor } from "./registry"
import type { BuiltinToolExecutionContext } from "./types"

export interface BuiltinToolWorkerPayload {
  readonly toolId: string
  readonly input: unknown
}

export async function executeBuiltinToolInCurrentThread(payload: BuiltinToolWorkerPayload): Promise<unknown> {
  const descriptor = getBuiltinToolDescriptor(payload.toolId)
  if (!descriptor) {
    throw new BuiltinToolError("unknown_tool", `Unknown builtin tool: ${payload.toolId}`)
  }
  const parsedInput = descriptor.inputSchema.safeParse(payload.input)
  if (!parsedInput.success) {
    throw new BuiltinToolError("invalid_input", parsedInput.error.message)
  }
  const context: BuiltinToolExecutionContext = {
    entryPoint: "tools",
    actor: { kind: "user" },
  }
  return descriptor.executor(parsedInput.data, context)
}

