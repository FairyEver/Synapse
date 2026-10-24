import { useCallback, useEffect, useRef, useState } from "react"
import type { AgentMcpInventory } from "@/types/agent-mcp"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("settings.agent-mcp")

export function useAgentMcpSettings() {
  const [projectId, setProjectId] = useState<string>()
  const [data, setData] = useState<AgentMcpInventory>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const generation = useRef(0)
  const mounted = useRef(false)
  const writePending = useRef(false)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    setLoading(true); setError(undefined)
    try {
      const result = await requireSynapseBridge().mcp.agent.list(projectId ? { projectId } : {})
      if (mounted.current && request === generation.current) setData(result)
    } catch {
      if (mounted.current && request === generation.current) {
        setData(undefined); setError("无法读取 MCP 配置，请刷新重试。")
        logger.error("Agent MCP inventory refresh failed.")
      }
    } finally {
      if (mounted.current && request === generation.current) setLoading(false)
    }
  }, [projectId])
  useEffect(() => {
    mounted.current = true
    setData(undefined)
    void refresh()
    return () => { mounted.current = false; generation.current++ }
  }, [refresh])
  const toggle = useCallback(async (name: string, enabled: boolean) => {
    if (writePending.current) return
    writePending.current = true; setSaving(true); setError(undefined)
    try {
      await requireSynapseBridge().mcp.agent.setEnabled({ name, enabled })
      if (mounted.current) await refresh()
    } catch {
      if (mounted.current) setError("保存失败，请重试。")
      logger.error("Agent MCP preference update failed.")
    } finally {
      writePending.current = false
      if (mounted.current) setSaving(false)
    }
  }, [refresh])
  return { data, loading, saving, error, projectId, setProjectId, refresh, toggle }
}
