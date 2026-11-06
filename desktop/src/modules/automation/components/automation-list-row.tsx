import { History, Loader2, Pencil, Play, Square, Trash2 } from "lucide-react"
import { useEffect, useRef, type MouseEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AutomationItem } from "@/types/automation"
import type { SynapseProjectConfig } from "@/types/config"
import {
  automationManualRunUnavailableReason,
  formatAutomationExecutorType,
  formatAutomationScope,
  formatAutomationTrigger,
} from "../utils"
import { AutomationNextRunTime } from "./automation-time"

type AutomationListRowProps = {
  readonly item: AutomationItem
  readonly projects: readonly SynapseProjectConfig[]
  readonly pending: boolean
  readonly running: boolean
  readonly onOpen: () => void
  readonly onEdit?: () => void
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
  if (item.schemaVersion === 1) return { label: "旧版已停用", variant: "outline" }
  if (item.validation?.status === "needs_update") return { label: "需要更新", variant: "outline" }
  if (!item.enabled) return { label: "已停用", variant: "outline" }
  if (item.activeRun?.status === "running") return { label: "运行中", variant: "secondary" }
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
  onEdit,
  onRun,
  onStop,
  onToggleEnabled,
  onHistory,
  onDelete,
}: AutomationListRowProps) {
  const activeRunning = item.activeRun?.status === "running"
  const nameButtonRef = useRef<HTMLButtonElement>(null)
  const stopFocusedRef = useRef(false)
  useEffect(() => {
    if (activeRunning || !stopFocusedRef.current) return
    stopFocusedRef.current = false
    if (document.activeElement === document.body) nameButtonRef.current?.focus()
  }, [activeRunning])
  const legacy = item.schemaVersion === 1
  const readOnly = item.schemaVersion !== 2 || item.readOnly
  const needsUpdate = legacy || item.validation?.status === "needs_update"
  const disabled = !item.enabled
  const badge = getStatusBadge(item)
  const executorType = formatAutomationExecutorType(item)
  const subtitle = `${formatAutomationTrigger(item)} · ${executorType}`
  const stopDisabled = pending || (activeRunning && !item.activeRun?.id)
  const manualRunUnavailableReason = automationManualRunUnavailableReason(item)
  const runDisabled = disabled || pending || running || needsUpdate || Boolean(manualRunUnavailableReason)

  return (
    <TableRow
      data-automation-id={item.id}
      className="cursor-pointer"
      onClick={onOpen}
    >
      <TableCell className="min-w-0">
        <div className="min-w-0">
          <Button
            ref={nameButtonRef}
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
          <div className="mt-1 flex flex-wrap items-center gap-2 @3xl/list:hidden"><Badge variant={badge.variant}>{badge.label}</Badge><span className="text-xs text-muted-foreground"><AutomationNextRunTime item={item} /></span></div>
        </div>
      </TableCell>
      <TableCell className="hidden @3xl/list:table-cell">
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </TableCell>
      <TableCell className="hidden truncate text-right tabular-nums text-muted-foreground @3xl/list:table-cell">
        <AutomationNextRunTime item={item} />
      </TableCell>
      <TableCell className="hidden truncate text-right text-muted-foreground @3xl/list:table-cell">
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
          disabled={pending || needsUpdate || legacy}
          aria-label={legacy
            ? `旧版自动化 ${item.name} 已停用`
            : needsUpdate
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
                disabled={readOnly}
                aria-label={`编辑自动化 ${item.name}`}
                onClick={() => {
                  if (onEdit) onEdit()
                  else onOpen()
                }}
              >
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{readOnly ? "当前客户端不可编辑" : "编辑"}</TooltipContent>
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
                  onFocus={() => { stopFocusedRef.current = true }}
                  onBlur={() => { stopFocusedRef.current = false }}
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
                <span className="inline-flex" tabIndex={manualRunUnavailableReason ? 0 : undefined}>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={runDisabled}
                    aria-label={legacy ? "旧版自动化不可运行" : needsUpdate ? "需要更新后才能运行自动化" : manualRunUnavailableReason ?? "运行自动化"}
                    onClick={() => {
                      onRun()
                    }}
                  >
                    {running ? <Loader2 className="animate-spin" /> : <Play />}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{legacy ? "旧版不可运行" : needsUpdate ? "需要更新" : manualRunUnavailableReason ?? "运行"}</TooltipContent>
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
