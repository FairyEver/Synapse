import { History, Loader2, Pencil, Play, Square, Trash2 } from "lucide-react"
import type { MouseEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AutomationItem } from "@/types/automation"
import type { SynapseProjectConfig } from "@/types/config"
import {
  formatAutomationExecutorType,
  formatAutomationScope,
  formatAutomationTriggerType,
} from "../utils"
import { AutomationNextRunTime } from "./automation-time"

type AutomationListRowProps = {
  readonly item: AutomationItem
  readonly projects: readonly SynapseProjectConfig[]
  readonly pending: boolean
  readonly running: boolean
  readonly onOpen: () => void
  readonly onRun: () => void
  readonly onStop: () => void
  readonly onToggleEnabled: (enabled: boolean) => void
  readonly onHistory: (event: MouseEvent<HTMLButtonElement>) => void
  readonly onDelete: (event: MouseEvent<HTMLButtonElement>) => void
}

function getStatusBadge(item: AutomationItem): {
  readonly label: string
  readonly variant: "default" | "secondary" | "destructive" | "outline"
} {
  if (item.validation?.status === "needs_update") return { label: "需要更新", variant: "outline" }
  if (!item.enabled) return { label: "已停用", variant: "outline" }
  if (item.lastStatus === "failed" || item.lastStatus === "timeout") {
    return { label: "上次失败", variant: "destructive" }
  }
  return { label: "已启用", variant: "secondary" }
}

function AutomationListRow({
  item,
  projects,
  pending,
  running,
  onOpen,
  onRun,
  onStop,
  onToggleEnabled,
  onHistory,
  onDelete,
}: AutomationListRowProps) {
  const activeRunning = item.activeRun?.status === "running"
  const needsUpdate = item.validation?.status === "needs_update"
  const disabled = !item.enabled
  const badge = getStatusBadge(item)
  const triggerType = formatAutomationTriggerType(item)
  const executorType = formatAutomationExecutorType(item)
  const subtitle = `触发器 ${triggerType} · 执行器 ${executorType}`
  const stopDisabled = activeRunning && !item.activeRun?.id
  const runDisabled = disabled || pending || running || needsUpdate

  return (
    <TableRow
      className="cursor-pointer"
      onClick={onOpen}
    >
      <TableCell className="min-w-0">
        <div className="min-w-0">
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 max-w-full justify-start px-0 py-0 font-medium hover:bg-transparent"
            title={item.name}
            onClick={(event) => {
              event.stopPropagation()
              onOpen()
            }}
          >
            <span className="truncate">{item.name}</span>
          </Button>
          <div className="truncate text-xs text-muted-foreground" title={subtitle}>
            {subtitle}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </TableCell>
      <TableCell className="truncate text-right tabular-nums text-muted-foreground">
        <AutomationNextRunTime item={item} />
      </TableCell>
      <TableCell className="truncate text-right text-muted-foreground">
        {formatAutomationScope(item, projects)}
      </TableCell>
      <TableCell
        className="text-right"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Switch
          size="sm"
          checked={item.enabled}
          disabled={pending || needsUpdate}
          aria-label={needsUpdate
            ? `需要更新后才能启用自动化 ${item.name}`
            : item.enabled ? `停用自动化 ${item.name}` : `启用自动化 ${item.name}`}
          onCheckedChange={onToggleEnabled}
        />
      </TableCell>
      <TableCell className="text-right">
        <div
          className="flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`编辑自动化 ${item.name}`}
                onClick={() => {
                  onOpen()
                }}
              >
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>编辑</TooltipContent>
          </Tooltip>
          {activeRunning ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={stopDisabled}
                  aria-label="停止运行"
                  onClick={() => {
                    onStop()
                  }}
                >
                  <Square />
                </Button>
              </TooltipTrigger>
              <TooltipContent>停止</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={runDisabled}
                  aria-label={needsUpdate ? "需要更新后才能运行自动化" : "运行自动化"}
                  onClick={() => {
                    onRun()
                  }}
                >
                  {running ? <Loader2 className="animate-spin" /> : <Play />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{needsUpdate ? "需要更新" : "运行"}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={pending}
                aria-label="查看运行历史"
                onClick={(event) => {
                  onHistory(event)
                }}
              >
                <History />
              </Button>
            </TooltipTrigger>
            <TooltipContent>历史</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={pending || activeRunning}
                aria-label={activeRunning ? "运行中不能删除" : "删除自动化"}
                onClick={(event) => {
                  onDelete(event)
                }}
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{activeRunning ? "先停止运行" : "删除"}</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  )
}

export { AutomationListRow }
export type { AutomationListRowProps }
