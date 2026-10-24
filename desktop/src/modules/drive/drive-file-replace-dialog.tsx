import type { DriveItemDto } from "@synapse/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { formatDriveBytes } from "@/lib/drive-format"
import { useDriveFileReplace } from "./use-drive-file-replace"

export function DriveFileReplaceDialog({ item, onClose, onChanged, onManageSync, onViewHistory, initialFilePath }: {
  readonly initialFilePath?: string
  readonly item: DriveItemDto
  readonly onViewHistory?: () => void
  readonly onClose: () => void
  readonly onChanged: () => void | Promise<void>
  readonly onManageSync: (bindingId: string) => void
}) {
  const flow = useDriveFileReplace(item, onChanged, initialFilePath)
  return <Dialog open onOpenChange={(open) => { if (!open && !flow.busy) onClose() }}>
    <DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{flow.result ? "云端已更新" : "上传新版本"}</DialogTitle></DialogHeader>
      <FieldGroup className="-mx-4 max-h-[60vh] w-auto overflow-auto px-4">
        <Field><FieldLabel>云端文件</FieldLabel><span className="break-all text-sm">{flow.result?.item.name ?? flow.preview?.name ?? item.name}</span></Field>
        {flow.result ? <Alert>
          <AlertTitle>云端已更新</AlertTitle>
          <AlertDescription>{flow.result.syncPending ? "本机同步尚未完成，可在同步管理中查看。" : "已保存新版本，可在历史版本中恢复。"}</AlertDescription>
        </Alert> : <>
          <Field><FieldLabel>本地文件</FieldLabel>
            {flow.filePath && <span className="break-all text-sm">{flow.filePath}</span>}
            <div><Button variant="outline" disabled={flow.busy} onClick={() => { void flow.choose() }}>选择文件</Button></div>
          </Field>
          {flow.preview && <>
            <div className="flex justify-between gap-3 text-sm"><span>文件大小</span><span className="tabular-nums">{formatDriveBytes(flow.preview.previousSize)} → {formatDriveBytes(flow.preview.size)}</span></div>
            <div className="text-sm text-muted-foreground">当前版本：{flow.preview.versionId}</div>
            <div className="text-sm text-muted-foreground">保留云端名称、分享链接和历史版本。</div>
            {flow.preview.syncImpacts.map((impact) => <Field key={impact.bindingId}>
              <FieldLabel>本机同步位置</FieldLabel><span className="break-all text-sm">{impact.localPath}</span>
              <span className="text-sm text-muted-foreground">{impact.status === "paused" ? "保持暂停" : "云端更新后检查本地差异"}</span>
              <div><Button variant="outline" onClick={() => onManageSync(impact.bindingId)}>管理同步</Button></div>
            </Field>)}
            {flow.preview.blockedReason && <Alert variant="destructive"><AlertDescription>{flow.preview.blockedReason}</AlertDescription></Alert>}
          </>}
        </>}
        {flow.error && <FieldError>{flow.error}</FieldError>}
      </FieldGroup>
      <DialogFooter>
        <Button variant="outline" disabled={flow.busy} onClick={onClose}>{flow.result ? "完成" : "取消"}</Button>
        {flow.result && onViewHistory && <Button onClick={onViewHistory}>查看历史版本</Button>}
        {!flow.result && flow.filePath && <Button variant="outline" disabled={flow.busy} onClick={() => { void flow.recheck() }}>重新检查</Button>}
        {!flow.result && <Button disabled={flow.busy || !flow.preview || Boolean(flow.preview.blockedReason)} onClick={() => { void flow.apply() }}>{flow.busy ? "处理中…" : "上传新版本"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
