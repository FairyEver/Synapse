import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SharedInstallerFlow } from "@/modules/installers/shared/shared-installer-flow"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type { SynapseRuleInstallerSource } from "@/types/installers"

type RuleInstallerModalProps = {
  editors: SynapseEditorAdapterSummary[]
  onInstalled?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
  projects: SynapseProjectConfig[]
  source: SynapseRuleInstallerSource | null
}

export function RuleInstallerModal({
  editors,
  onInstalled,
  onOpenChange,
  open,
  projects,
  source,
}: RuleInstallerModalProps) {
  if (!source) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rule 安装器</DialogTitle>
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
