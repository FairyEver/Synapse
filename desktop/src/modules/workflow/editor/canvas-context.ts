import { createContext, useContext } from "react"
import type { WorkflowNode, WorkflowEdge } from "@/types/workflow"

export interface NodeClipboard {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface CanvasActions {
  clipboard: NodeClipboard | null
  getSelectedNodeIds: () => string[]
  copyNodes: (nodeIds: string[]) => void
  pasteNodes: (anchorNodeId: string) => void
  disconnectNodes: (nodeIds: string[]) => void
  deleteNodes: (nodeIds: string[]) => void
  requestRename: (nodeId: string) => void
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null)

export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasActionsContext)
  if (!ctx) throw new Error("useCanvasActions must be used within CanvasActionsContext")
  return ctx
}
