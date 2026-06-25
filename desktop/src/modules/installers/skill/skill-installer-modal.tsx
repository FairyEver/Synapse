import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SharedInstallerFlow } from "@/modules/installers/shared/shared-installer-flow"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type { SynapseSkillInstallerSource } from "@/types/installers"

type SkillInstallerModalProps = {
  editors: SynapseEditorAdapterSummary[]
  onInstalled?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
  projects: SynapseProjectConfig[]
  source: SynapseSkillInstallerSource | null
}

export function SkillInstallerModal({
  editors,
  onInstalled,
  onOpenChange,
  open,
  projects,
  source,
}: SkillInstallerModalProps) {
  if (!source) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Skill 安装器</DialogTitle>
        </DialogHeader>
        <SharedInstallerFlow
          editors={editors}
          mode="modal"
          projects={projects}
          source={source}
          onCancel={() => onOpenChange(false)}
          onInstalled={async () => {
            await onInstalled?.()
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
