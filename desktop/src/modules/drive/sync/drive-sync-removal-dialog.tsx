import type { DriveSyncBindingDto, DriveSyncRemovalDisposition } from "@synapse/shared"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { DriveSyncController } from "./use-drive-sync"
import { useDriveSyncRemoval } from "./use-drive-sync-removal"

const choices: readonly { value: DriveSyncRemovalDisposition; label: string }[] = [
  { value: "keep_both", label: "保留两端文件" }, { value: "keep_local", label: "只保留本地" },
  { value: "keep_remote", label: "只保留云端" }, { value: "delete_both", label: "删除两端同步内容" },
]
const outcome = { retained: "已保留", trashed: "已移入回收站", failed: "处理失败" }
export function DriveSyncRemovalDialog({ controller, binding, onClose, onRemoved }: {
  readonly controller: DriveSyncController; readonly binding: DriveSyncBindingDto
  readonly onClose: () => void; readonly onRemoved: () => void
}) {
  const flow = useDriveSyncRemoval(controller, binding, onRemoved)
  return <AlertDialog open onOpenChange={(open) => { if (!open && !flow.busy) onClose() }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>解除同步 {binding.driveItemName}</AlertDialogTitle>
        <AlertDialogDescription>停止双向同步，选择两端文件的处理方式。</AlertDialogDescription>
      </AlertDialogHeader>
      <FieldGroup className="-mx-4 max-h-[60vh] w-auto overflow-auto px-4">
        <RadioGroup aria-label="解除后的文件处理" value={flow.disposition} disabled={flow.busy || Boolean(flow.result) || binding.status === "removed"} onValueChange={(value) => flow.choose(value as DriveSyncRemovalDisposition)}>
          {choices.map((choice) => <Field key={choice.value} orientation="horizontal"><RadioGroupItem id={`remove-${choice.value}`} value={choice.value} /><FieldLabel htmlFor={`remove-${choice.value}`}>{choice.label}</FieldLabel></Field>)}
        </RadioGroup>
        {flow.result && <Alert><AlertDescription>同步关系已解除。本地：{outcome[flow.result.local]}；云端：{outcome[flow.result.remote]}。</AlertDescription></Alert>}
        {flow.preview && <>
          <Field><FieldLabel>本地</FieldLabel><span className="break-all text-sm">{flow.preview.localPath}</span></Field>
          <Field><FieldLabel>云端</FieldLabel><span className="break-all text-sm">{flow.preview.drivePathHint || binding.driveItemName}</span></Field>
          {flow.disposition === "keep_both" ? <span className="text-sm text-muted-foreground">云盘和电脑上的文件都会保留。</span> : <>
            <span className="text-sm">移入回收站：本地 {flow.preview.localPaths.length} 项，云端 {flow.preview.remotePaths.length} 项。</span>
            <details><summary className="cursor-pointer text-sm">查看待处理路径</summary><div className="max-h-40 overflow-auto text-sm">{flow.preview.localPaths.map((path) => <div key={`local:${path}`} className="break-all">本地 {path}</div>)}{flow.preview.remotePaths.map((path) => <div key={`remote:${path}`} className="break-all">云端 {path}</div>)}</div></details>
            <Field orientation="horizontal"><Checkbox id="remove-confirm" checked={flow.confirmed} disabled={flow.busy} onCheckedChange={(value) => flow.setConfirmed(value === true)} /><FieldLabel htmlFor="remove-confirm">确认以上文件移入回收站</FieldLabel></Field>
          </>}
          {flow.preview.warnings.map((warning) => <Alert key={warning}><AlertDescription>{warning}</AlertDescription></Alert>)}
          {flow.preview.blockedReason && <FieldError>{flow.preview.blockedReason}</FieldError>}
        </>}
        {(flow.result?.errors.length || binding.status === "removed") && <span className="text-sm text-muted-foreground">可保留未完成的文件；已移入回收站的内容不会还原。</span>}
        {flow.error && <FieldError>{flow.error}</FieldError>}
      </FieldGroup>
      <AlertDialogFooter>
        <Button variant="outline" disabled={flow.busy} onClick={onClose}>关闭</Button>
        {(flow.result?.errors.length || binding.status === "removed") && <Button variant="outline" disabled={flow.busy || controller.readOnly} onClick={() => { void flow.abandon() }}>保留剩余文件</Button>}
        {!flow.preview && <Button variant="outline" disabled={flow.busy} onClick={() => { void flow.recheck() }}>重新检查</Button>}
        <Button variant={flow.disposition === "keep_both" ? "default" : "destructive"} disabled={flow.busy || controller.readOnly || !flow.preview || Boolean(flow.preview.blockedReason) || (flow.disposition !== "keep_both" && !flow.confirmed)} onClick={() => { void flow.apply() }}>{flow.busy ? "处理中…" : flow.result ? "重试未完成项" : "解除同步"}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
