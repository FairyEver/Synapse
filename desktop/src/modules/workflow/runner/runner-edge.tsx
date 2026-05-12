import { useContext } from "react"
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import { Badge } from "@/components/ui/badge"
import { RunnerNodeResultsContext } from "./runner-node-wrappers"

export function RunnerEdge({
  id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}: EdgeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const sourceStatus = nodeResults[source]?.status
  const activated = sourceStatus === "success"

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  const label = (data as { label?: string } | undefined)?.label

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={activated ? "#3b82f6" : "#3f3f46"}
        strokeWidth={2}
        strokeOpacity={activated ? 0.6 : 1}
        strokeDasharray={activated ? undefined : "4 4"}
      />
      {label && (
        <EdgeLabelRenderer>
          <Badge
            variant="outline"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
            className="absolute bg-background text-xs pointer-events-none nodrag nopan"
          >
            {label}
          </Badge>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
