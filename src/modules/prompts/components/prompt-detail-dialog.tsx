import {
  ContentDetailDialog,
  type ContentDetailDialogLabels,
} from "@/modules/content/components/content-detail-dialog"
import { PromptCreateDialog } from "@/modules/prompts/components/prompt-create-dialog"
import { PromptVersionView } from "@/modules/prompts/components/prompt-version-view"
import type { CreatePromptPayload } from "@/modules/prompts/types"
import type { SynapseContentDetail, SynapsePromptMeta } from "@/types/content"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"

type PromptDetailDialogProps = {
  item: SynapsePromptMeta | null
  onContentChanged?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  refreshSignal?: number
}

const PROMPT_LABELS: ContentDetailDialogLabels = {
  singular: "提示词",
  deleteConfirmTitle: "确认删除这条提示词？",
  deleteConfirmDescription: "删除后，这条提示词会从列表里隐藏，但历史记录仍会保留在仓库里。",
  deleteLoading: "正在删除提示词...",
  deleteError: "删除提示词失败。",
  conflictTitle: "有人在你之后改过这条提示词",
  conflictDescription: (name, time) =>
    `${name} 在 ${time} 改过这条提示词。你的修改会成为最新版本。`,
  emptyDescription: "它可能已经被删除。",
  emptyTitle: "找不到这条提示词",
  errorTitle: "无法显示提示词",
  loadingTitle: "正在读取提示词",
}

function PromptDetailDialog({
  item,
  onContentChanged,
  onOpenChange,
  open,
  refreshSignal = 0,
}: PromptDetailDialogProps) {
  return (
    <ContentDetailDialog<CreatePromptPayload>
      contentType="prompt"
      item={item}
      labels={PROMPT_LABELS}
      logCategory="prompts.detail"
      onContentChanged={onContentChanged}
      onOpenChange={onOpenChange}
      open={open}
      refreshSignal={refreshSignal}
      renderCreateDialog={(props) => <PromptCreateDialog {...props} />}
      renderVersionView={({ mode, version }) => (
        <PromptVersionView
          mode={mode}
          surface="plain"
          version={version as unknown as SynapseLoadedContentVersion<"prompt">}
        />
      )}
      buildInitialValue={(detail: SynapseContentDetail): CreatePromptPayload => ({
        title: detail.title,
        description: detail.description,
        category: detail.category,
        icon: detail.icon,
        iconBg: detail.iconBg,
        content: detail.content,
      })}
    />
  )
}

export { PromptDetailDialog }
