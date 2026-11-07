import { useEffect, useRef } from "react"
import type { CustomAppId } from "@synapse/shared"

import { getSynapseBridge } from "@/lib/electron-bridge"

export function WebAppViewport({ appId }: { readonly appId: CustomAppId }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    const bridge = getSynapseBridge()?.customApps
    if (!element || !bridge) return undefined
    let disposed = false

    const sendBounds = () => {
      if (disposed) return
      const rect = element.getBoundingClientRect()
      void bridge.view.setBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      })
    }

    const observer = new ResizeObserver(sendBounds)
    observer.observe(element)
    const initial = element.getBoundingClientRect()
    void bridge.view.attach({
      appId,
      bounds: {
        x: Math.round(initial.left),
        y: Math.round(initial.top),
        width: Math.max(0, Math.round(initial.width)),
        height: Math.max(0, Math.round(initial.height)),
      },
    })
    window.addEventListener("resize", sendBounds)

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener("resize", sendBounds)
      void bridge.view.detach()
    }
  }, [appId])

  return <div ref={ref} data-custom-app-viewport className="h-full min-h-0 w-full" />
}
