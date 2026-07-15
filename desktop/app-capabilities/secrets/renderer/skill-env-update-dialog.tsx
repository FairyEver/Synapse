import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { Checkbox } from "../../../src/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "../../../src/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../src/components/ui/table"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type {
  SecretSkillEnvScanResult,
  SkillEnvBindingItem,
  SkillEnvBindingQueueItem,
} from "../shared/schema"

type SkillEnvUpdateScanGroup = {
  readonly name: string
  readonly scanResult: SecretSkillEnvScanResult
}

type SkillEnvUpdateDialogProps = {
  readonly groups: readonly SkillEnvUpdateScanGroup[]
  readonly onOpenChange: (open: boolean) => void
  readonly onQueueError: (error: unknown) => void
}

type QueueResultById = Record<
  string,
  Pick<SkillEnvBindingQueueItem, "status" | "message">
>

type QueueErrorKind = "failed" | "session_expired"

type GroupedBindingItem = {
  readonly groupId: string
  readonly groupName: string
  readonly item: SkillEnvBindingItem
  readonly itemKey: string
}

function groupId(name: string): string {
  return name.toLowerCase()
}

function itemKey(name: string, itemId: string): string {
  return `${groupId(name)}\u0000${itemId}`
}

function groupsSignature(groups: readonly SkillEnvUpdateScanGroup[]): string {
  return groups.map(({ name, scanResult }) => `${groupId(name)}\u0000${scanResult.scanSessionId}`).join("\u0001")
}

function queueErrorKind(error: unknown): QueueErrorKind {
  return error instanceof Error && error.message.includes("扫描会话已过期")
    ? "session_expired"
    : "failed"
}

export function SkillEnvUpdateDialog({
  groups,
  onOpenChange,
  onQueueError,
}: SkillEnvUpdateDialogProps) {
  const [activeGroups, setActiveGroups] = useState<readonly SkillEnvUpdateScanGroup[]>(groups)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [queueResults, setQueueResults] = useState<QueueResultById>({})
  const [queueErrors, setQueueErrors] = useState<Record<string, QueueErrorKind>>({})
  const [updating, setUpdating] = useState(false)
  const activeSessionRef = useRef("")
  const secretsBridge = useMemo(() => requireBridgeDomain("secrets"), [])

  const groupedItems = useMemo<GroupedBindingItem[]>(() => activeGroups.flatMap((group) => (
    group.scanResult.items.map((item) => ({
      groupId: groupId(group.name),
      groupName: group.name,
      item,
      itemKey: itemKey(group.name, item.id),
    }))
  )), [activeGroups])

  useEffect(() => {
    setActiveGroups(groups)
    activeSessionRef.current = groupsSignature(groups)
    setSelectedIds(groups.flatMap((group) => group.scanResult.items
      .filter((item) => item.status === "needs_update")
      .map((item) => itemKey(group.name, item.id))))
    setQueueResults({})
    setQueueErrors({})
    setUpdating(false)
  }, [groups])

  const toggleItem = (bindingKey: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(bindingKey) ? current : [...current, bindingKey]
      : current.filter((id) => id !== bindingKey))
  }

  const rescanGroup = async (name: string) => {
    if (updating) return
    const targetGroupId = groupId(name)
    setUpdating(true)
    try {
      const scanResult = await secretsBridge.scanSkillEnvBindings({ name })
      const nextGroups = activeGroups.map((group) => (
        groupId(group.name) === targetGroupId ? { name: group.name, scanResult } : group
      ))
      setActiveGroups(nextGroups)
      activeSessionRef.current = groupsSignature(nextGroups)
      setQueueErrors((current) => {
        const next = { ...current }
        delete next[targetGroupId]
        return next
      })
      setQueueResults((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${targetGroupId}\u0000`)),
      ))
      setSelectedIds((current) => [
        ...current.filter((key) => !key.startsWith(`${targetGroupId}\u0000`)),
        ...scanResult.items
          .filter((item) => item.status === "needs_update")
          .map((item) => itemKey(name, item.id)),
      ])
    } catch (error) {
      setQueueErrors((current) => ({ ...current, [targetGroupId]: "failed" }))
      onQueueError(error)
    } finally {
      setUpdating(false)
    }
  }

  const queueSelected = async () => {
    if (updating || selectedIds.length === 0) return
    const sessionSignature = groupsSignature(activeGroups)
    activeSessionRef.current = sessionSignature
    setUpdating(true)

    const deselectedKeys: string[] = []
    const nextResults: QueueResultById = {}
    const nextErrors: Record<string, QueueErrorKind> = {}

    for (const group of activeGroups) {
      const groupItemIds = group.scanResult.items
        .filter((item) => selectedIds.includes(itemKey(group.name, item.id)))
        .map((item) => item.id)
      if (groupItemIds.length === 0) continue

      try {
        const result = await secretsBridge.queueSkillEnvBindings({
          name: group.name,
          scanSessionId: group.scanResult.scanSessionId,
          itemIds: groupItemIds,
        })
        if (activeSessionRef.current !== sessionSignature) return
        for (const item of result.items) {
          const key = itemKey(group.name, item.id)
          nextResults[key] = { status: item.status, message: item.message }
          if (item.status === "updated" || item.status === "conflict") deselectedKeys.push(key)
        }
      } catch (error) {
        if (activeSessionRef.current !== sessionSignature) return
        nextErrors[groupId(group.name)] = queueErrorKind(error)
        onQueueError(error)
      }
    }

    if (activeSessionRef.current === sessionSignature) {
      setQueueResults((current) => ({ ...current, ...nextResults }))
      setQueueErrors(nextErrors)
      setSelectedIds((current) => current.filter((key) => !deselectedKeys.includes(key)))
      setUpdating(false)
    }
  }

  return (
    <Dialog open={groups.length > 0} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton={false}
      >
        <DialogFrame>
          <DialogFrameHeader bordered title="更新 Skill 配置" />
          <DialogFrameBody className="flex flex-col overflow-auto">
            {Object.entries(queueErrors).length > 0 ? (
              <div className="flex flex-col gap-2 border-b px-5 py-3">
                {Object.entries(queueErrors).map(([id, kind]) => {
                  const group = activeGroups.find((entry) => groupId(entry.name) === id)
                  if (!group) return null
                  return (
                    <div key={id} className="flex items-center justify-between gap-3" role="alert">
                      <p className="text-sm text-destructive">
                        {kind === "session_expired"
                          ? `${group.name} 的扫描会话已过期，请重新扫描。`
                          : `${group.name} 的更新请求失败，请重试。`}
                      </p>
                      {kind === "session_expired" ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => void rescanGroup(group.name)}>
                          重新扫描
                        </Button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : null}
            <Table className="min-w-4xl">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10"><span className="sr-only">选择</span></TableHead>
                  <TableHead>配置键</TableHead>
                  <TableHead>Skill</TableHead>
                  <TableHead>编辑器</TableHead>
                  <TableHead>范围</TableHead>
                  <TableHead>路径</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedItems.map(({ groupId: bindingGroupId, groupName, item, itemKey: bindingKey }) => {
                  const queueResult = queueResults[bindingKey]
                  const requiresRescan = queueResult?.status === "conflict"
                  const selectable = item.status === "needs_update"
                    && queueResult?.status !== "updated"
                    && !requiresRescan
                  return (
                    <TableRow key={bindingKey}>
                      <TableCell>
                        <Checkbox
                          aria-label={`选择 Skill：${item.skillName}（${groupName}）`}
                          checked={selectedIds.includes(bindingKey)}
                          disabled={!selectable || updating}
                          onCheckedChange={(checked) => toggleItem(bindingKey, checked === true)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{groupName}</TableCell>
                      <TableCell className="font-medium">{item.skillName}</TableCell>
                      <TableCell>{item.editors.map((editor) => editor.label).join("、")}</TableCell>
                      <TableCell>{scopeLabel(item)}</TableCell>
                      <TableCell className="max-w-80 truncate font-mono text-xs" title={item.envPath}>
                        {item.envPath}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <BindingStatus
                            item={item}
                            queueError={queueErrors[bindingGroupId]}
                            queueResult={queueResult}
                          />
                          {requiresRescan ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              disabled={updating}
                              onClick={() => void rescanGroup(groupName)}
                            >
                              重新扫描
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </DialogFrameBody>
          <DialogFrameFooter>
            <Button
              type="button"
              disabled={updating || selectedIds.length === 0}
              onClick={() => void queueSelected()}
            >
              {updating ? "更新中" : "更新选中项"}
            </Button>
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

function BindingStatus({
  item,
  queueError,
  queueResult,
}: {
  readonly item: SkillEnvBindingItem
  readonly queueError: QueueErrorKind | undefined
  readonly queueResult: Pick<SkillEnvBindingQueueItem, "status" | "message"> | undefined
}) {
  const queueStatus = queueResult?.status
  const label = queueStatus ? queueStatusLabel(queueStatus) : scanStatusLabel(item.status)
  const destructive = queueError !== undefined
    || queueStatus === "failed"
    || queueStatus === "conflict"
    || item.status === "invalid"
    || item.status === "unwritable"
    || item.status === "unsafe_link"
  const message = queueResult?.message ?? item.message
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={destructive ? "destructive" : "secondary"}>{label}</Badge>
      {message ? (
        <p className="max-w-64 whitespace-normal break-words text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  )
}

function scanStatusLabel(status: SkillEnvBindingItem["status"]): string {
  switch (status) {
    case "needs_update": return "待更新"
    case "up_to_date": return "已是最新"
    case "invalid": return "格式错误"
    case "unwritable": return "不可写"
    case "unsafe_link": return "不安全路径"
  }
}

function queueStatusLabel(status: SkillEnvBindingQueueItem["status"]): string {
  switch (status) {
    case "updated": return "已更新"
    case "failed": return "更新失败"
    case "conflict": return "文件已变化"
  }
}

function scopeLabel(item: SkillEnvBindingItem): string {
  if (item.scope === "global") return "全局"
  return item.projectName ? `项目：${item.projectName}` : "项目"
}

export type { SkillEnvUpdateScanGroup }
