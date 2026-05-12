import { useContext, useEffect, useRef, useState } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
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
  const [showParticle, setShowParticle] = useState(false)
  const prevStatusRef = useRef(sourceStatus)

  useEffect(() => {
    if (prevStatusRef.current === "running" && sourceStatus === "success") {
      setShowParticle(true)
      const timer = setTimeout(() => setShowParticle(false), 800)
      return () => clearTimeout(timer)
    }
    prevStatusRef.current = sourceStatus
  }, [sourceStatus])

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
      {showParticle && (
        <>
          <circle r={4} fill="#60a5fa" opacity={0.9}>
            <animateMotion dur="0.8s" fill="freeze" path={edgePath} calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" keyPoints="0;1" />
          </circle>
          <circle r={7} fill="#3b82f6" opacity={0.3}>
            <animateMotion dur="0.8s" fill="freeze" path={edgePath} calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" keyPoints="0;1" />
          </circle>
        </>
      )}
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
