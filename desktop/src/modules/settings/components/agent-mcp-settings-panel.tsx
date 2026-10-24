import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAgentMcpSettings } from "../hooks/use-agent-mcp-settings"

const sourceLabels: Record<string, string> = {
  user: "Claude Code · 用户全局", project: "Claude Code · 项目", local: "Claude Code · 本地项目",
  plugin: "Claude Code · 插件", synapse: "SY 连接器", builtin: "内置", saved: "已保存的禁用项", managed: "受管配置",
}

export function AgentMcpSettingsPanel() {
  const { data, loading, saving, error, projectId, setProjectId, refresh, toggle } = useAgentMcpSettings()
  const [query, setQuery] = useState("")
  const items = useMemo(() => data?.items.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [], [data, query])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent 使用的 MCP</CardTitle>
        <CardAction>
          <Button variant="outline" aria-label="刷新 Agent MCP" disabled={loading || saving} onClick={() => void refresh()}>
            <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : undefined} data-icon="inline-start" />刷新
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">仅影响 SY，运行中的任务在下一轮应用。此处显示本机配置，不代表连接状态。</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId ? `project:${projectId}` : "default"} onValueChange={value => setProjectId(value === "default" ? undefined : value.slice(8))} disabled={loading || saving}>
            <SelectTrigger aria-label="MCP 项目范围"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">默认工作区</SelectItem>
              {data?.projects.map(project => <SelectItem key={project.id} value={`project:${project.id}`}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="min-w-0 flex-1" aria-label="搜索 MCP" placeholder="搜索 MCP" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取…</p> : null}
        {!loading && data ? (
          <div className="divide-y">
            {items.map(item => (
              <div key={item.name} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.name === "synapse-mcp" ? "Synapse" : item.name}</div>
                  <div className="text-sm text-muted-foreground">{sourceLabels[item.source] ?? item.source}{!item.configurable && item.source !== "builtin" ? " · 策略限制" : ""}</div>
                </div>
                <Switch aria-label={`在 SY 中启用 ${item.name}`} checked={item.enabled} disabled={saving || !item.configurable} onCheckedChange={enabled => void toggle(item.name, enabled)} />
              </div>
            ))}
            {!items.length ? <p className="py-3 text-sm text-muted-foreground">没有匹配的 MCP。</p> : null}
          </div>
        ) : null}
        {data?.warnings.map(warning => <p key={warning} role="status" className="text-sm text-muted-foreground">{warning}</p>)}
      </CardContent>
    </Card>
  )
}
