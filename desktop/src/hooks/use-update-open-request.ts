import { useEffect, useRef } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAppUpdateOpenRequest } from "@/types/update"

const logger = createRendererLogger("update-open-request")

type UpdateOpenRequestControls = {
  acknowledge: () => Promise<void>
}

type UpdateOpenRequestHandler = (
  request: SynapseAppUpdateOpenRequest,
  controls: UpdateOpenRequestControls,
) => void | Promise<void>

function useUpdateOpenRequest(handler: UpdateOpenRequestHandler): void {
  const handlerRef = useRef(handler)
  const lastHandledRequestIdRef = useRef(0)
  handlerRef.current = handler

  useEffect(() => {
    const bridge = getSynapseBridge()?.updater
    if (!bridge) return

    let cancelled = false

    const handleRequest = (request: SynapseAppUpdateOpenRequest) => {
      if (cancelled || request.id <= lastHandledRequestIdRef.current) return
      lastHandledRequestIdRef.current = request.id

      void Promise.resolve(handlerRef.current(request, {
        acknowledge: () => bridge.acknowledgeOpenRequest(request.id),
      })).catch((error) => {
        logger.error("Failed to handle update open request.", {
          automatic: request.automatic,
          error,
          requestId: request.id,
        })
      })
    }

    const unsubscribe = bridge.onOpenRequest(handleRequest)
    void bridge.getPendingOpenRequest()
      .then((request) => {
        if (request) handleRequest(request)
      })
      .catch((error) => {
        logger.error("Failed to read pending update open request.", error)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
}

export { useUpdateOpenRequest }
export type { UpdateOpenRequestControls, UpdateOpenRequestHandler }
