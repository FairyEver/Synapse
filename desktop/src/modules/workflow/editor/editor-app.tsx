import { useCallback, useEffect, useRef, useState } from "react"
import type { WorkflowDefinition, NodeRunResult } from "@/types/workflow"
import { useWorkflowRun } from "../hooks/use-workflow-run"
import { useWorkflowEvents } from "../hooks/use-workflow-events"
import { WorkflowToolbar } from "./toolbar"
import { WorkflowCanvas, type WorkflowCanvasHandle } from "./canvas"
import { ExecutionOverlay } from "./execution-overlay"
import { NodePalette } from "./node-palette"
import { NodeConfigPanel } from "./node-config-panel"

export function WorkflowEditorApp() {
  const workflowId = new URLSearchParams(window.location.search).get("workflowId") ?? ""
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const canvasRef = useRef<WorkflowCanvasHandle>(null)
  const definitionRef = useRef(definition)
  definitionRef.current = definition

  useEffect(() => { if (workflowId) void window.synapse?.workflow.get(workflowId).then((def) => { if (def) setDefinition(def) }) }, [workflowId])

  const { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel } = useWorkflowRun(workflowId)

  useWorkflowEvents(runId, {
    onNodeStarted: (nodeId) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "running" as const } })),
    onNodeCompleted: (nodeId, output) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "success" as const, output: String(output) } })),
    onNodeFailed: (nodeId, error) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "failed" as const, error } })),
    onNodeSkipped: (nodeId) => setNodeResults((r) => ({ ...r, [nodeId]: { nodeId, input: { variables: {} }, status: "skipped" as const } })),
    onCompleted: (results) => { setRunState("completed"); setNodeResults(results) },
    onFailed: () => setRunState("failed"),
    onCancelled: () => setRunState("cancelled"),
  })

  const handleConfigChange = useCallback((nodeId: string, config: Record<string, unknown>) => {
    canvasRef.current?.updateNodeConfig(nodeId, config)
    setDefinition((def) => def ? { ...def, nodes: def.nodes.map((n) => n.id === nodeId ? { ...n, config } : n) } : def)
  }, [])

  const handleSave = async (def: WorkflowDefinition) => {
    const result = await window.synapse?.workflow.save(def)
    if (result && "versionHash" in result) setDefinition({ ...def, version: result.versionHash })
    return result
  }

  if (!definition) return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">加载中…</div>

  return (
    <div className="flex flex-col h-screen">
      <WorkflowToolbar definition={definition} runState={runState} onSave={handleSave} onRun={start} onCancel={cancel} onChange={setDefinition} />
      <div className="flex-1 flex min-h-0">
        <NodePalette />
        <div className="flex-1 relative">
          <WorkflowCanvas ref={canvasRef} definition={definition} nodeResults={nodeResults} onChange={setDefinition} onNodeSelect={setSelectedNodeId} />
          <ExecutionOverlay nodeResults={nodeResults} runState={runState} />
        </div>
        <NodeConfigPanel nodeId={selectedNodeId} definition={definition} onConfigChange={handleConfigChange} />
      </div>
    </div>
  )
}
