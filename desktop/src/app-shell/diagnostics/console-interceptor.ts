import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const MAX_SERIALIZED_LENGTH = 2048

type ConsoleArgDiagnostic = {
  argType: string
  errorName?: string
  messageLength?: number
  serializedLength?: number
  stackLength?: number
  textLength?: number
}

function getArgType(arg: unknown): string {
  if (arg === null) return "null"
  if (arg instanceof Error) return arg.name || "Error"
  if (Array.isArray(arg)) return "array"
  return typeof arg
}

function describeArg(arg: unknown): ConsoleArgDiagnostic {
  if (arg instanceof Error) {
    return {
      argType: arg.name || "Error",
      errorName: arg.name || "Error",
      messageLength: arg.message.length,
      stackLength: arg.stack?.length,
    }
  }
  if (typeof arg === "string") {
    return {
      argType: "string",
      textLength: arg.length,
    }
  }
  if (arg === null || arg === undefined) return { argType: getArgType(arg) }
  try {
    const json = JSON.stringify(arg)
    return {
      argType: getArgType(arg),
      serializedLength: Math.min(json.length, MAX_SERIALIZED_LENGTH),
    }
  } catch {
    return {
      argType: getArgType(arg),
      serializedLength: String(arg).length,
    }
  }
}

function formatArgs(args: unknown[]): { meta: unknown } {
  const first = args[0]
  return {
    meta: {
      argCount: args.length,
      args: args.map(describeArg),
      boundary: "renderer.console",
      firstArgType: args.length === 0 ? "empty" : getArgType(first),
    },
  }
}

const REACT_DEV_PREFIXES = [
  "Warning: ",
  "React does not recognize",
  "Each child in a list",
  "Cannot update a component",
  "Can't perform a React state update",
]

function isReactDevWarning(args: unknown[]): boolean {
  if (process.env.NODE_ENV === "production") return false
  const first = args[0]
  if (typeof first !== "string") return false
  return REACT_DEV_PREFIXES.some((prefix) => first.startsWith(prefix))
}

export function installConsoleInterceptor(logger: RendererLogger): () => void {
  const originalError = console.error
  const originalWarn = console.warn

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    if (isReactDevWarning(args)) return
    const { meta } = formatArgs(args)
    guardedLog(logger, "error", "Renderer console error.", meta)
  }

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    if (isReactDevWarning(args)) return
    const { meta } = formatArgs(args)
    guardedLog(logger, "warn", "Renderer console warning.", meta)
  }

  return () => {
    console.error = originalError
    console.warn = originalWarn
  }
}
