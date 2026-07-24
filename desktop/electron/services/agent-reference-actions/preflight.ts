import { AgentReferenceActionFailure } from "./failure"

export type AgentReferencePreflight = {
  readonly deadline?: number
  readonly abortSignal?: AbortSignal
}

export function createAgentReferencePreflight(options: {
  readonly hasNetworkBoundary: boolean
  readonly timeoutMs: number
  readonly abortSignal?: AbortSignal
  readonly now: () => number
}): AgentReferencePreflight {
  return {
    deadline: options.hasNetworkBoundary
      ? options.now() + options.timeoutMs
      : undefined,
    abortSignal: options.abortSignal,
  }
}

export async function awaitAgentReferencePreflight<T>(
  operation: () => Promise<T>,
  preflight: AgentReferencePreflight,
  stage: string,
  now: () => number,
): Promise<T> {
  ensureAgentReferencePreflightActive(preflight, now)
  const races: Promise<T>[] = [operation()]
  let timeout: ReturnType<typeof setTimeout> | undefined
  let removeAbort: (() => void) | undefined
  if (preflight.deadline !== undefined) {
    const remaining = preflight.deadline - now()
    if (remaining <= 0) throw new AgentReferenceActionFailure("network_timeout", stage)
    races.push(new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new AgentReferenceActionFailure("network_timeout", stage)),
        remaining,
      )
    }))
  }
  if (preflight.abortSignal) {
    races.push(new Promise<T>((_resolve, reject) => {
      const onAbort = () => reject(new AgentReferenceActionFailure("cancelled_before_submission", stage))
      preflight.abortSignal?.addEventListener("abort", onAbort, { once: true })
      removeAbort = () => preflight.abortSignal?.removeEventListener("abort", onAbort)
    }))
  }
  try {
    return await Promise.race(races)
  } finally {
    if (timeout) clearTimeout(timeout)
    removeAbort?.()
  }
}

export function ensureAgentReferencePreflightActive(
  preflight: AgentReferencePreflight,
  now: () => number,
): void {
  if (preflight.abortSignal?.aborted) {
    throw new AgentReferenceActionFailure("cancelled_before_submission", "sender")
  }
  if (preflight.deadline !== undefined && preflight.deadline <= now()) {
    throw new AgentReferenceActionFailure("network_timeout", "deadline")
  }
}
