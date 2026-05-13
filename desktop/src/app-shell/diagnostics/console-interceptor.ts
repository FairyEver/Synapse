import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const MAX_SERIALIZED_LENGTH = 2048

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { message: arg.message, stack: arg.stack }
  }
  if (typeof arg === "string") return arg
  if (arg === null || arg === undefined) return arg
  try {
    const json = JSON.stringify(arg)
    if (json.length > MAX_SERIALIZED_LENGTH) {
      return json.slice(0, MAX_SERIALIZED_LENGTH) + "...[truncated]"
    }
    return JSON.parse(json)
  } catch {
    return String(arg)
  }
}

function formatArgs(args: unknown[]): { message: string; meta?: unknown } {
  if (args.length === 0) return { message: "(empty)" }

  const first = args[0]
  if (first instanceof Error) {
    return {
      message: first.message || "Error",
      meta: { stack: first.stack, args: args.slice(1).map(serializeArg) },
    }
  }

  const message = typeof first === "string" ? first : String(first)
  if (args.length === 1) return { message }

  const rest = args.slice(1).map(serializeArg)
  return { message, meta: rest.length === 1 ? rest[0] : rest }
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
    const { message, meta } = formatArgs(args)
    guardedLog(logger, "error", message, meta)
  }

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    if (isReactDevWarning(args)) return
    const { message, meta } = formatArgs(args)
    guardedLog(logger, "warn", message, meta)
  }

  return () => {
    console.error = originalError
    console.warn = originalWarn
  }
}
