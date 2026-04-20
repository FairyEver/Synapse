import {
  ContentDetailDialog,
  type ContentDetailDialogLabels,
} from "@/modules/content/components/content-detail-dialog"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
import { RuleVersionView } from "@/modules/rules/components/rule-version-view"
import type { CreateRulePayload } from "@/modules/rules/types"
import type { SynapseContentDetail, SynapseRuleMeta } from "@/types/content"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"

type RuleDetailDialogProps = {
  item: SynapseRuleMeta | null
  onContentChanged?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  refreshSignal?: number
}

const RULE_LABELS: ContentDetailDialogLabels = {
  singular: "规则",
  deleteConfirmTitle: "确认删除这条规则？",
  deleteConfirmDescription: "删除后，这条规则会从列表里隐藏，但历史记录仍会保留在仓库里。",
  deleteLoading: "正在删除 Rule...",
  deleteError: "删除 Rule 失败。",
  conflictTitle: "有人在你之后改过这条规则",
  conflictDescription: (name, time) =>
    `${name} 在 ${time} 改过这条规则。你的修改会成为最新版本。`,
  emptyDescription: "它可能已经被删除。",
  emptyTitle: "找不到这条规则",
  errorTitle: "无法显示规则",
  loadingTitle: "正在读取规则",
}

function RuleDetailDialog({
  item,
  onContentChanged,
  onOpenChange,
  open,
  refreshSignal = 0,
}: RuleDetailDialogProps) {
  return (
    <ContentDetailDialog<CreateRulePayload>
      contentType="rule"
      item={item}
      labels={RULE_LABELS}
      logCategory="rules.detail"
      onContentChanged={onContentChanged}
      onOpenChange={onOpenChange}
      open={open}
      refreshSignal={refreshSignal}
      renderCreateDialog={(props) => <RuleCreateDialog {...props} />}
      renderVersionView={({ mode, version }) => (
        <RuleVersionView
          mode={mode}
          surface="plain"
          version={version as unknown as SynapseLoadedContentVersion<"rule">}
        />
      )}
      buildInitialValue={(detail: SynapseContentDetail): CreateRulePayload => ({
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

export { RuleDetailDialog }
