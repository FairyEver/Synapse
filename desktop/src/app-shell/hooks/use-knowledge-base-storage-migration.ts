import { useEffect, useState } from "react"
import type { SynapseKnowledgeBaseStorageMigrationProgress } from "@/types/knowledge-base"

const idleProgress: SynapseKnowledgeBaseStorageMigrationProgress = {
  active: false,
  phase: "idle",
  cancellable: false,
  copiedBytes: 0,
  totalBytes: null,
  message: "",
}

function useKnowledgeBaseStorageMigration() {
  const [progress, setProgress] = useState<SynapseKnowledgeBaseStorageMigrationProgress>(idleProgress)

  useEffect(() => {
    const bridge = window.synapse?.knowledgeBase
    let disposed = false
    let receivedEvent = false
    const unsubscribe = bridge?.onStorageMigrationChanged?.((nextProgress) => {
      receivedEvent = true
      if (!disposed) {
        setProgress(nextProgress)
      }
    })

    void bridge?.getStorageMigrationState?.()
      .then((snapshot) => {
        if (!disposed && !receivedEvent) {
          setProgress(snapshot)
        }
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return {
    progress,
    cancel: () => window.synapse?.knowledgeBase.cancelStorageMigration?.(),
  }
}

export { useKnowledgeBaseStorageMigration }
