import { LoaderCircle, MoreHorizontal, RefreshCw } from "lucide-react"
import type { ComponentProps } from "react"

import { EditorIcon } from "@/components/editor-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseEditorInstallStatusEntry,
  SynapseEditorInstallStatusValue,
} from "@/types/editor-install-status"

type EditorInstallStatusPanelProps = {
  entries: SynapseEditorInstallStatusEntry[]
  error: string | null
  isLoading: boolean
  onOpenInstallTarget: (entry: SynapseEditorInstallStatusEntry) => void
  onRefresh: () => void
}

type EditorInstallStatusDetailListProps = {
  entries: SynapseEditorInstallStatusEntry[]
  onOpenInstallTarget: (entry: SynapseEditorInstallStatusEntry) => void
}

type EditorInstallStatusGroup = {
  editorId: SynapseEditorInstallStatusEntry["editorId"]
  editorLabel: string
  entries: SynapseEditorInstallStatusEntry[]
}

const statusLabels: Record<SynapseEditorInstallStatusValue, string> = {
  conflict: "冲突",
  external_same_name: "外部同名",
  installed: "已安装",
  needs_update: "需更新",
  not_installed: "未安装",
  unavailable: "不可用",
  unsupported: "不支持",
}

type RowAction = {
  label: string
}

function getRowActions(status: SynapseEditorInstallStatusValue): RowAction[] {
  switch (status) {
    case "not_installed":
      return [{ label: "安装" }]
    case "needs_update":
      return [{ label: "更新" }]
    case "installed":
      return [{ label: "重新安装" }]
    default:
      return []
  }
}

function canOpenStatus(status: SynapseEditorInstallStatusValue): boolean {
  return status === "conflict"
    || status === "external_same_name"
    || status === "installed"
    || status === "needs_update"
}

function getScopeLabel(entry: SynapseEditorInstallStatusEntry): string {
  if (entry.scope === "global") {
    return "全局"
  }

  return entry.projectName ?? "项目"
}

function getStatusVariant(status: SynapseEditorInstallStatusValue): ComponentProps<typeof Badge>["variant"] {
  if (status === "conflict") {
    return "destructive"
  }

  if (status === "installed") {
    return "default"
  }

  if (status === "needs_update" || status === "unsupported") {
    return "secondary"
  }

  return "outline"
}

function openTargetPath(path: string) {
  getSynapseBridge()?.shell.showItemInFolder(path).catch(() => {})
}

function groupEntriesByEditor(entries: SynapseEditorInstallStatusEntry[]): EditorInstallStatusGroup[] {
  const groupMap = new Map<string, EditorInstallStatusGroup>()

  for (const entry of entries) {
    const group = groupMap.get(entry.editorId)

    if (group) {
      group.entries.push(entry)
      continue
    }

    groupMap.set(entry.editorId, {
      editorId: entry.editorId,
      editorLabel: entry.editorLabel,
      entries: [entry],
    })
  }

  return Array.from(groupMap.values())
}

function orderEntriesForEditor(entries: SynapseEditorInstallStatusEntry[]): SynapseEditorInstallStatusEntry[] {
  return [...entries].sort((left, right) => {
    if (left.scope === right.scope) {
      return 0
    }

    return left.scope === "global" ? -1 : 1
  })
}

function renderInstallStatusTargetList({
  entries,
  onOpenInstallTarget,
}: EditorInstallStatusDetailListProps) {
  return (
    <div className="divide-y divide-border">
      {orderEntriesForEditor(entries).map((entry) => {
        const actions = getRowActions(entry.status)
        const targetPath = entry.targetPath
        const openableTargetPath = targetPath && canOpenStatus(entry.status)
          ? targetPath
          : null

        return (
          <div
            key={`${entry.editorId}-${entry.scope}-${entry.projectId ?? "global"}-${entry.status}`}
            className="grid gap-2 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p data-install-status-row-title="" className="truncate font-medium">
                    {getScopeLabel(entry)}
                  </p>
                  <Badge variant={getStatusVariant(entry.status)}>
                    {statusLabels[entry.status]}
                  </Badge>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {actions.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="更多操作">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {actions.map((action) => (
                        <DropdownMenuItem
                          key={action.label}
                          onSelect={() => onOpenInstallTarget(entry)}
                        >
                          {action.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>

            {openableTargetPath || entry.message ? (
              <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                {openableTargetPath ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto min-w-0 justify-start p-0 text-left text-muted-foreground hover:text-foreground"
                    onClick={() => openTargetPath(openableTargetPath)}
                  >
                    <span className="min-w-0 break-all">{openableTargetPath}</span>
                  </Button>
                ) : null}
                {entry.message ? <p>{entry.message}</p> : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function EditorInstallStatusDetailList({
  entries,
  onOpenInstallTarget,
}: EditorInstallStatusDetailListProps) {
  if (entries.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground">未检测到目标</p>
    )
  }

  const editorGroups = groupEntriesByEditor(entries)
  const defaultEditorId = editorGroups[0].editorId

  return (
    <TooltipProvider>
      <Tabs defaultValue={defaultEditorId} className="gap-2">
        <TabsList variant="line" className="mx-auto h-auto! w-fit justify-center gap-0 overflow-visible py-1">
          {editorGroups.map((group) => (
            <Tooltip key={group.editorId}>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value={group.editorId}
                  aria-label={group.editorLabel}
                  className="size-10 flex-none rounded-md p-0.5 after:hidden hover:bg-muted/50 data-active:bg-muted data-[state=active]:bg-muted"
                >
                  <EditorIcon editorId={group.editorId} className="size-9" />
                  <span className="sr-only">{group.editorLabel}</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>{group.editorLabel}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>

        {editorGroups.map((group) => (
          <TabsContent key={group.editorId} value={group.editorId} className="mt-0">
            <div className="flex flex-col gap-2">
              <p data-install-status-editor-heading="" className="font-medium">
                {group.editorLabel}
              </p>
              {renderInstallStatusTargetList({
                entries: group.entries,
                onOpenInstallTarget,
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </TooltipProvider>
  )
}

function EditorInstallStatusPanel({
  entries,
  error,
  isLoading,
  onOpenInstallTarget,
  onRefresh,
}: EditorInstallStatusPanelProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="rounded-sm px-1.5 font-normal!">
          {isLoading ? <LoaderCircle className="animate-spin" /> : null}
          安装状态
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-[420px]" showCloseButton={false}>
        <DialogFrame className="max-h-[calc(100vh-2rem)]">
          <DialogFrameHeader
            title="安装状态"
            actions={(
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={onRefresh}
            >
              {isLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {error ? "重试" : "刷新"}
            </Button>
            )}
          >
            <DialogDescription className="sr-only">
              编辑器安装状态
            </DialogDescription>
          </DialogFrameHeader>

          <DialogFrameBody>
            <ScrollArea className="h-full min-h-0">
              <div className="px-5 py-4">
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : (
                  <EditorInstallStatusDetailList
                    entries={entries}
                    onOpenInstallTarget={onOpenInstallTarget}
                  />
                )}
              </div>
            </ScrollArea>
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

export { EditorInstallStatusDetailList, EditorInstallStatusPanel }
export type { EditorInstallStatusDetailListProps, EditorInstallStatusPanelProps }
