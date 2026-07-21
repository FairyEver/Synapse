import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import type { WorkflowShareExportPreflight } from "@/types/workflow-package"

interface WorkflowExportDialogProps {
  open: boolean
  preflight: WorkflowShareExportPreflight | null
  exporting: boolean
  onOpenChange: (open: boolean) => void
  onExport: (shareNote: string) => void
}

export function WorkflowExportDialog({
  open,
  preflight,
  exporting,
  onOpenChange,
  onExport,
}: WorkflowExportDialogProps) {
  const [shareNote, setShareNote] = useState("")

  useEffect(() => {
    setShareNote(preflight?.shareNote ?? "")
  }, [preflight])

  if (!preflight) return null
  const localResources = preflight.references.resources.filter((resource) => (
    resource.kind === "local_path" || resource.kind === "staged"
  ))
  const warningCount = preflight.risks.sensitiveLocations.length
    + preflight.risks.highRiskLocations.length
    + preflight.risks.portabilityWarnings.length
  const blocked = preflight.blockers.length > 0

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!exporting) onOpenChange(nextOpen) }}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-[640px]"
        showCloseButton={false}
      >
        <DialogFrame className="max-h-[calc(100vh-2rem)]">
          <DialogFrameHeader title="导出工作流" showCloseButton={!exporting} />
          <DialogFrameBody className="overflow-y-auto overscroll-contain px-5 py-4">
            <div className="grid gap-4">
              <div className="grid grid-cols-[7rem_1fr] items-baseline gap-x-3 gap-y-2 text-sm">
                <span className="text-muted-foreground">内容</span>
                <span>{preflight.workflows.length} 个工作流，{preflight.workflows.reduce((sum, workflow) => sum + workflow.nodeCount, 0)} 个节点</span>
                <span className="text-muted-foreground">依赖</span>
                <span>{preflight.references.models.length} 个模型，{preflight.references.projects.length} 个项目，{preflight.references.resources.length} 个资源</span>
                <span className="text-muted-foreground">提示</span>
                <span>{warningCount} 项风险或兼容提示</span>
              </div>
              {blocked ? (
                <Alert variant="destructive">
                  <AlertDescription>{preflight.blockers.join("；")}</AlertDescription>
                </Alert>
              ) : null}
              {localResources.length > 0 ? (
                <div className="space-y-2">
                  <Alert>
                    <AlertDescription>以下本地文件或目录不在包内，请另行发送。</AlertDescription>
                  </Alert>
                  <div className="divide-y rounded-lg border px-3">
                    {localResources.map((resource) => (
                      <div key={resource.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate">{resource.displayName ?? "本地资源"}</span>
                        <span className="shrink-0 text-muted-foreground">{resource.entryType === "file" ? "文件" : "目录"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {preflight.risks.sensitiveLocations.length > 0 ? (
                <div className="space-y-2">
                  <Alert>
                    <AlertDescription>以下位置可能包含敏感信息，内容会原样导出。</AlertDescription>
                  </Alert>
                  <div className="divide-y rounded-lg border px-3">
                    {preflight.risks.sensitiveLocations.map((location, index) => (
                      <div key={`${location.workflowRef}-${location.nodeId ?? "workflow"}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate">{location.nodeName ?? "工作流设置"}</span>
                        <span className="shrink-0 text-muted-foreground">{location.fieldPath.join(".")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {preflight.risks.excludedAutomationCount > 0 ? (
                <Alert>
                  <AlertDescription>{preflight.risks.excludedAutomationCount} 个关联 Automation 不会导出。</AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="workflow-share-note">分享说明</Label>
                <Textarea
                  id="workflow-share-note"
                  value={shareNote}
                  maxLength={20_000}
                  rows={5}
                  disabled={exporting}
                  onChange={(event) => setShareNote(event.target.value)}
                />
              </div>
              {preflight.workflows.length > 1 ? (
                <ScrollArea className="max-h-32 rounded-lg border">
                  <div className="divide-y px-3">
                    {preflight.workflows.map((workflow) => (
                      <div key={workflow.ref} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="truncate">{workflow.name}</span>
                        <span className="shrink-0 text-muted-foreground">{workflow.nodeCount} 个节点</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : null}
            </div>
          </DialogFrameBody>
          <DialogFrameFooter>
            <Button type="button" variant="outline" disabled={exporting} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="button" disabled={blocked || exporting} onClick={() => onExport(shareNote)}>
              {exporting ? "导出中..." : "导出文件"}
            </Button>
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}
