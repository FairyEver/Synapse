import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseCliDetectResult } from "@/types/cli"

const logger = createRendererLogger("cli.detect")

function useCliDetect() {
  const [results, setResults] = useState<SynapseCliDetectResult[]>([])
  const [loading, setLoading] = useState(true)

  const detect = useCallback(() => {
    setLoading(true)
    requireSynapseBridge()
      .cli.detect()
      .then(setResults)
      .catch((error) => {
        logger.error("Failed to detect CLI tools.", error)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    detect()
  }, [detect])

  return { results, loading, refresh: detect }
}

export { useCliDetect }
