import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"

export type ImportedScriptConfirmationItem = {
  readonly workflowName: string
  readonly nodeName: string
  readonly runtime: string
  readonly source: string
}

export function ScriptConfirmationDialog(props: {
  readonly open: boolean
  readonly scripts: readonly ImportedScriptConfirmationItem[]
  readonly confirming?: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.confirming) props.onCancel()
      }}
    >
      <DialogContent
        className="h-[calc(100vh-2rem)] max-h-[48rem] p-0 sm:max-w-3xl"
        showCloseButton={false}
      >
        <DialogFrame>
          <DialogFrameHeader
            title="确认运行导入脚本"
            description="确认后，这些脚本将以当前用户权限运行。"
            showCloseButton={!props.confirming}
          />
          <DialogFrameBody className="overflow-y-auto px-5 py-4">
            <div className="space-y-6">
              {props.scripts.map((script, index) => (
                <section
                  key={`${script.workflowName}:${script.nodeName}:${index}`}
                  className="space-y-2"
                >
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">工作流</dt>
                    <dd>{script.workflowName}</dd>
                    <dt className="text-muted-foreground">运行时</dt>
                    <dd>{script.runtime}</dd>
                    <dt className="text-muted-foreground">节点</dt>
                    <dd>{script.nodeName}</dd>
                  </dl>
                  <pre
                    aria-label={`${script.workflowName} ${script.nodeName} 源码`}
                    className="overflow-x-auto whitespace-pre-wrap break-words bg-muted p-3 font-mono text-xs"
                  >
                    {script.source}
                  </pre>
                </section>
              ))}
            </div>
          </DialogFrameBody>
          <DialogFrameFooter>
            <Button type="button" variant="outline" disabled={props.confirming} onClick={props.onCancel}>
              取消
            </Button>
            <Button type="button" disabled={props.confirming} onClick={props.onConfirm}>
              确认并运行
            </Button>
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}
