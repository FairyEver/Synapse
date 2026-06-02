export const DEFAULT_AGENT_TIMEOUT_MINS = 60

export function resolveAgentTimeoutMins(timeoutMins: number | undefined): number {
  return timeoutMins ?? DEFAULT_AGENT_TIMEOUT_MINS
}

export function agentTimeoutMinsToMs(timeoutMins: number): number {
  return timeoutMins * 60_000
}
