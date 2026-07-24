import { createContext, useContext } from "react"
import { Position } from "@xyflow/react"
import type { WorkflowLayoutDirection } from "@/types/workflow"

export const WorkflowLayoutDirectionContext = createContext<WorkflowLayoutDirection>("horizontal")

export const WorkflowLayoutDirectionProvider = WorkflowLayoutDirectionContext.Provider

export function useWorkflowLayoutDirection(): WorkflowLayoutDirection {
  return useContext(WorkflowLayoutDirectionContext)
}

export function resolveWorkflowHandlePositions(direction: WorkflowLayoutDirection): {
  target: Position
  source: Position
} {
  return direction === "vertical"
    ? { target: Position.Top, source: Position.Bottom }
    : { target: Position.Left, source: Position.Right }
}

export function useWorkflowHandlePositions(): {
  target: Position
  source: Position
} {
  return resolveWorkflowHandlePositions(useWorkflowLayoutDirection())
}
