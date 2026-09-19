import type { SynapseSystemAppTerminalOpenRequest } from "@/modules/apps/types"

const OPEN_TERMINAL_SESSION_EVENT = "synapse:app:open_terminal_session:operation"

function requestOpenTerminalSession(request: SynapseSystemAppTerminalOpenRequest): void {
  window.dispatchEvent(new CustomEvent(OPEN_TERMINAL_SESSION_EVENT, { detail: request }))
}

function subscribeOpenTerminalSession(
  listener: (request: SynapseSystemAppTerminalOpenRequest) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<SynapseSystemAppTerminalOpenRequest>).detail)
  }

  window.addEventListener(OPEN_TERMINAL_SESSION_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_TERMINAL_SESSION_EVENT, handleEvent)
  }
}

function isMainAppWindow(): boolean {
  return new URLSearchParams(window.location.search).get("window") === null
}

export {
  isMainAppWindow,
  requestOpenTerminalSession,
  subscribeOpenTerminalSession,
}
