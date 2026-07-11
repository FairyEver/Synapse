import { Dialog, DialogContent, DialogFrame, DialogFrameBody, DialogFrameHeader } from "@/components/ui/dialog"
import type { SkillUninstallBatchResult, SkillUninstallQuery } from "../shared/schema"
import { SkillUninstallerFlow } from "./skill-uninstaller-flow"

export type SkillUninstallerDialogProps = {
  readonly open: boolean
  readonly query: SkillUninstallQuery | null
  readonly onOpenChange: (open: boolean) => void
  readonly onCompleted?: (result: SkillUninstallBatchResult) => Promise<void> | void
}

export function SkillUninstallerDialog(props: SkillUninstallerDialogProps) {
  if (!props.query) return null
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[min(42rem,calc(100vh-2rem))] p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogFrame>
          <DialogFrameHeader title="Skill 卸载器" bordered />
          <DialogFrameBody className="overflow-hidden px-5 py-4">
            <SkillUninstallerFlow
              mode="modal"
              initialQuery={props.query}
              queryReadOnly
              autoScan
              onCancel={() => props.onOpenChange(false)}
              onCompleted={props.onCompleted}
            />
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}
