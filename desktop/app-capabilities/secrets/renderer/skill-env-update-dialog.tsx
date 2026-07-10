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

type SkillEnvUpdateDialogProps = {
  readonly name: string
  readonly scanResult: SecretSkillEnvScanResult | null
  readonly onOpenChange: (open: boolean) => void
  readonly onQueueError: (error: unknown) => void
}

type QueueResultById = Record<
  string,
  Pick<SkillEnvBindingQueueItem, "status" | "message">
>

export function SkillEnvUpdateDialog({
  name,
  scanResult,
  onOpenChange,
  onQueueError,
}: SkillEnvUpdateDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [queueResults, setQueueResults] = useState<QueueResultById>({})
  const [updating, setUpdating] = useState(false)
  const activeSessionRef = useRef<string | null>(null)
  const secretsBridge = useMemo(() => requireBridgeDomain("secrets"), [])

  useEffect(() => {
    const sessionId = scanResult?.scanSessionId ?? null
    activeSessionRef.current = sessionId
    setSelectedIds(scanResult?.items
      .filter((item) => item.status === "needs_update")
      .map((item) => item.id) ?? [])
    setQueueResults({})
    setUpdating(false)
  }, [scanResult])

  const toggleItem = (itemId: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(itemId) ? current : [...current, itemId]
      : current.filter((id) => id !== itemId))
  }

  const queueSelected = async () => {
    if (!scanResult || updating || selectedIds.length === 0) return
    const scanSessionId = scanResult.scanSessionId
    const itemIds = scanResult.items
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => item.id)

    setUpdating(true)
    try {
      const result = await secretsBridge.queueSkillEnvBindings({ name, scanSessionId, itemIds })
      if (activeSessionRef.current !== scanSessionId) return
      setQueueResults(Object.fromEntries(result.items.map((item) => [item.id, {
        status: item.status,
        message: item.message,
      }])))
      setSelectedIds([])
    } catch (error) {
      if (activeSessionRef.current === scanSessionId) onQueueError(error)
    } finally {
      if (activeSessionRef.current === scanSessionId) setUpdating(false)
    }
  }

  return (
    <Dialog open={Boolean(scanResult)} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton={false}
      >
        <DialogFrame>
          <DialogFrameHeader bordered title="更新 Skill 配置" />
          <DialogFrameBody className="overflow-auto">
            <Table className="min-w-3xl">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10"><span className="sr-only">选择</span></TableHead>
                  <TableHead>Skill</TableHead>
                  <TableHead>编辑器</TableHead>
                  <TableHead>范围</TableHead>
                  <TableHead>路径</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scanResult?.items.map((item) => {
                  const selectable = item.status === "needs_update" && queueResults[item.id] === undefined
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={`选择 Skill：${item.skillName}`}
                          checked={selectedIds.includes(item.id)}
                          disabled={!selectable || updating}
                          onCheckedChange={(checked) => toggleItem(item.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{item.skillName}</TableCell>
                      <TableCell>{item.editors.map((editor) => editor.label).join("、")}</TableCell>
                      <TableCell>{scopeLabel(item)}</TableCell>
                      <TableCell className="max-w-80 truncate font-mono text-xs" title={item.envPath}>
                        {item.envPath}
                      </TableCell>
                      <TableCell>
                        <BindingStatus item={item} queueResult={queueResults[item.id]} />
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
  queueResult,
}: {
  readonly item: SkillEnvBindingItem
  readonly queueResult: Pick<SkillEnvBindingQueueItem, "status" | "message"> | undefined
}) {
  const queueStatus = queueResult?.status
  const label = queueStatus ? queueStatusLabel(queueStatus) : scanStatusLabel(item.status)
  const destructive = queueStatus === "failed"
    || queueStatus === "conflict"
    || item.status === "invalid"
    || item.status === "unwritable"
    || item.status === "unsafe_link"
  return (
    <div className="space-y-1">
      <Badge variant={destructive ? "destructive" : "secondary"}>{label}</Badge>
      {queueResult?.message ? (
        <p className="max-w-64 whitespace-normal break-words text-xs text-muted-foreground">
          {queueResult.message}
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
