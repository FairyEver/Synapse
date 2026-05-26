import type { EditorScanSkillCopyItem } from "@/modules/editor-scan/lib/editor-copy-source"

type EditorBulkSkillCopyDialogProps = {
  items: EditorScanSkillCopyItem[]
  onCopied?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
}

function EditorBulkSkillCopyDialog(_props: EditorBulkSkillCopyDialogProps) {
  return null
}

export { EditorBulkSkillCopyDialog }
export type { EditorBulkSkillCopyDialogProps }
