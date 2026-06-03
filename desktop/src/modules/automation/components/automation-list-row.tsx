import { History, Loader2, Play, Square, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AutomationItem } from "@/types/automation"
import type { SynapseProjectConfig } from "@/types/config"
import {
  formatAutomationExecutor,
  formatAutomationNextRun,
  formatAutomationScope,
  formatAutomationTrigger,
} from "../utils"

type AutomationListRowProps = {
  readonly item: AutomationItem
  readonly projects: readonly SynapseProjectConfig[]
  readonly busy: boolean
  readonly onOpen: () => void
  readonly onRun: () => void
  readonly onStop: () => void
  readonly onToggleEnabled: (enabled: boolean) => void
  readonly onHistory: () => void
  readonly onDelete: () => void
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
  busy,
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
  const triggerSummary = formatAutomationTrigger(item)
  const executorSummary = formatAutomationExecutor(item)
  const stopDisabled = activeRunning && !item.activeRun?.id

  return (
    <Item
      size="sm"
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_9rem_7rem_4rem_auto] items-center gap-3 bg-card hover:bg-muted/50"
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onOpen()
      }}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <span className="min-w-0 truncate">{item.name}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </ItemTitle>
        <ItemDescription className="truncate">
          {triggerSummary} · {executorSummary}
        </ItemDescription>
      </ItemContent>
      <span className="justify-self-end truncate text-right text-sm text-muted-foreground">
        {formatAutomationNextRun(item)}
      </span>
      <span className="justify-self-end truncate text-right text-sm text-muted-foreground">
        {formatAutomationScope(item, projects)}
      </span>
      <div
        className="flex justify-end"
        onClick={(event) => event.stopPropagation()}
      >
        <Switch
          size="sm"
          checked={item.enabled}
          disabled={busy || needsUpdate}
          aria-label={needsUpdate
            ? `需要更新后才能启用自动化 ${item.name}`
            : item.enabled ? `停用自动化 ${item.name}` : `启用自动化 ${item.name}`}
          onCheckedChange={onToggleEnabled}
        />
      </div>
      <ItemActions className="w-32 justify-end gap-1">
        {activeRunning ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={stopDisabled}
                aria-label="停止运行"
                onClick={(event) => {
                  event.stopPropagation()
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
                disabled={disabled || busy}
                aria-label="运行自动化"
                onClick={(event) => {
                  event.stopPropagation()
                  onRun()
                }}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Play />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>运行</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label="查看运行历史"
              onClick={(event) => {
                event.stopPropagation()
                onHistory()
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
              disabled={busy || activeRunning}
              aria-label={activeRunning ? "运行中不能删除" : "删除自动化"}
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{activeRunning ? "先停止运行" : "删除"}</TooltipContent>
        </Tooltip>
      </ItemActions>
    </Item>
  )
}

export { AutomationListRow }
export type { AutomationListRowProps }
