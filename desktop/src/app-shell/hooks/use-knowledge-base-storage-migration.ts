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
    return window.synapse?.knowledgeBase.onStorageMigrationChanged?.(setProgress)
  }, [])

  return {
    progress,
    cancel: () => window.synapse?.knowledgeBase.cancelStorageMigration?.(),
  }
}

export { useKnowledgeBaseStorageMigration }
