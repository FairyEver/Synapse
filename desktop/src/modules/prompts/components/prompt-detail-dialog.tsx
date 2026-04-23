import {
  ContentDetailDialog,
  type ContentDetailDialogLabels,
} from "@/modules/content/components/content-detail-dialog"
import { buildBaseContentInitialValue } from "@/modules/content/lib/content-payload"
import { PromptCreateDialog } from "@/modules/prompts/components/prompt-create-dialog"
import { PromptVersionView } from "@/modules/prompts/components/prompt-version-view"
import type { SynapseCreatePromptPayload, SynapsePromptMeta } from "@/types/content"
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
  deleteConfirmDescription: "内容将移入「最近删除」，90 天后自动永久清除。",
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
    <ContentDetailDialog<SynapseCreatePromptPayload>
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
      buildInitialValue={buildBaseContentInitialValue}
    />
  )
}

export { PromptDetailDialog }
