import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFrame, DialogFrameBody, DialogFrameFooter, DialogFrameHeader } from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { formatDriveBytes } from "@/lib/drive-format"
import type { DriveUploadReviewController } from "./use-drive-upload-review"

export function DriveUploadReviewDialog({ controller, onManageSync }: {
  readonly controller: DriveUploadReviewController
  readonly onManageSync: (bindingId: string) => void
}) {
  const blocked = Boolean(controller.error || controller.review?.replacements.some((item) => item.preview.blockedReason))
  return <Dialog open={Boolean(controller.review)} onOpenChange={(open) => { if (!open && !controller.checking) controller.cancel() }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-2xl">
      <DialogFrame className="max-h-[calc(100vh-2rem)]">
        <DialogFrameHeader title="确认上传新版本" bordered />
        <DialogFrameBody className="flex flex-col gap-4 overflow-auto px-5 py-4">
          <div className="text-sm text-muted-foreground">以下同名文件将保存为新版本。文件夹中的其他云端文件保留。</div>
          {controller.review?.replacements.map(({ path, preview }) => <div key={`${path}:${preview.itemId}`} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-all font-medium">{path}</span><span className="shrink-0 tabular-nums">{formatDriveBytes(preview.previousSize)} → {formatDriveBytes(preview.size)}</span></div>
            {preview.syncImpacts.map((impact) => <div key={impact.bindingId} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 break-all text-muted-foreground">{impact.localPath} · {impact.status === "paused" ? "保持暂停" : "更新后检查同步差异"}</span>
              <Button variant="outline" disabled={controller.checking} onClick={() => { controller.cancel(); onManageSync(impact.bindingId) }}>管理同步</Button>
            </div>)}
            {preview.blockedReason && <Alert variant="destructive"><AlertDescription>{preview.blockedReason}</AlertDescription></Alert>}
          </div>)}
          {controller.error && <FieldError>{controller.error}</FieldError>}
        </DialogFrameBody>
        <DialogFrameFooter>
          <Button variant="outline" disabled={controller.checking} onClick={controller.cancel}>取消</Button>
          <Button variant="outline" disabled={controller.checking} onClick={() => { void controller.recheck() }}>重新检查</Button>
          <Button disabled={controller.checking || blocked} onClick={controller.confirm}>{controller.checking ? "检查中…" : "确认上传"}</Button>
        </DialogFrameFooter>
      </DialogFrame>
    </DialogContent>
  </Dialog>
}
