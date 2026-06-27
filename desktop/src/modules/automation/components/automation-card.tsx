import { History, Pencil, Play, Square, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { SynapseProjectConfig } from "@/types/config"
import type { AutomationItem } from "@/types/automation"
import {
  formatAutomationExecutor,
  formatAutomationScope,
  formatAutomationTrigger,
} from "../utils"
import { AutomationLastRunTime, AutomationNextRunTime } from "./automation-time"

type AutomationCardProps = {
  item: AutomationItem
  projects: readonly SynapseProjectConfig[]
  pending: boolean
  running: boolean
  onRun: () => void
  onStop: () => void
  onToggleEnabled: (enabled: boolean) => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}

function getStatusBadge(item: AutomationItem): {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
} {
  if (item.validation?.status === "needs_update") return { label: "需要更新", variant: "outline" }
  if (!item.enabled) return { label: "已停用", variant: "outline" }
  if (item.lastStatus === "failed" || item.lastStatus === "timeout") {
    return { label: "上次失败", variant: "destructive" }
  }
  return { label: "已启用", variant: "secondary" }
}

function AutomationCard({
  item,
  projects,
  pending,
  running,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
}: AutomationCardProps) {
  const needsUpdate = item.validation?.status === "needs_update"
  const disabled = !item.enabled
  const activeRunning = item.activeRun?.status === "running"
  const badge = getStatusBadge(item)
  const deleteDisabled = pending || activeRunning

  return (
    <div className={`flex h-full flex-col rounded-lg bg-card p-4 text-card-foreground ${disabled ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <Switch
          size="sm"
          checked={item.enabled}
          disabled={pending || needsUpdate}
          aria-label={needsUpdate
            ? `需要更新后才能启用自动化 ${item.name}`
            : item.enabled ? `停用自动化 ${item.name}` : `启用自动化 ${item.name}`}
          onCheckedChange={onToggleEnabled}
        />
      </div>

      <div className="mt-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{item.name}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {item.description?.trim() || "暂无备注"}
          </p>
        </div>
        <div className="shrink-0">
          {activeRunning ? (
            <Button variant="destructive" size="sm" onClick={onStop}>
              <Square className="size-3.5" />
              停止
            </Button>
          ) : (
            <Button
              variant={item.lastStatus === "failed" || item.lastStatus === "timeout" ? "default" : "secondary"}
              size="sm"
              disabled={disabled || pending || running}
              onClick={onRun}
            >
              <Play className="size-3.5" />
              {item.lastStatus === "failed" || item.lastStatus === "timeout" ? "重试" : "运行"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 p-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">下次执行</p>
          <p className="mt-1 truncate text-sm font-medium">
            <AutomationNextRunTime item={item} />
          </p>
        </div>
        <div className="min-w-0 border-l border-border pl-3">
          <p className="text-xs text-muted-foreground">触发器</p>
          <p className="mt-1 truncate text-sm font-medium">{formatAutomationTrigger(item)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-1 text-xs">
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">执行器</span>
          <span className="truncate">{formatAutomationExecutor(item)}</span>
        </div>
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">上次</span>
          <AutomationLastRunTime item={item} className="truncate" />
        </div>
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">范围</span>
          <span className="truncate">{formatAutomationScope(item, projects)}</span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-end gap-1 pt-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="编辑" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={pending} aria-label="历史" onClick={onHistory}>
              <History className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>历史</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="icon-sm"
              disabled={deleteDisabled}
              aria-label={activeRunning ? "运行中不能删除" : "删除"}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{activeRunning ? "先停止运行" : "删除"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export { AutomationCard }
export type { AutomationCardProps }
