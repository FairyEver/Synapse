import { useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseQuickInputItem } from "@/types/quick-input"

const logger = createRendererLogger("renderer.quick-input")

const EMPTY_QUICK_INPUTS: readonly SynapseQuickInputItem[] = []

function useQuickInputItems(initialItems: readonly SynapseQuickInputItem[] = EMPTY_QUICK_INPUTS): readonly SynapseQuickInputItem[] {
  const [items, setItems] = useState<SynapseQuickInputItem[]>(() => [...initialItems])

  useEffect(() => {
    setItems([...initialItems])
  }, [initialItems])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    try {
      const bridge = requireBridgeDomain("quickInput")
      void bridge.item.list().then((nextItems) => {
        if (!disposed) setItems(nextItems)
      }).catch((rawError: unknown) => {
        logger.warn("Quick input load failed.", {
          boundary: "renderer.quick-input.load",
          ...errorDiagnostic(rawError),
        })
      })
      unsubscribe = bridge.item.onChanged((event) => {
        setItems(event.items)
      })
    } catch (rawError) {
      logger.warn("Quick input bridge unavailable.", {
        boundary: "renderer.quick-input.bridge",
        ...errorDiagnostic(rawError),
      })
    }
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return items
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { useQuickInputItems }
