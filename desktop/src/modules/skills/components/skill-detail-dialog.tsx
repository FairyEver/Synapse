import type {
  EditOverwriteRulePrefill,
  EditOverwriteSkillPrefill,
} from "@/app-shell/content-navigation"
import {
  ContentDetailDialog,
  type ContentDetailDialogLabels,
} from "@/modules/content/components/content-detail-dialog"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import { SkillVersionView } from "@/modules/skills/components/skill-version-view"
import type { CreateSkillPayload } from "@/modules/skills/types"
import { serializeCreateSkillFiles } from "@/modules/skills/utils"
import type { SynapseContentDetail, SynapseSkillMeta } from "@/types/content"

type SkillDetailDialogProps = {
  item: SynapseSkillMeta | null
  onContentChanged?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  refreshSignal?: number
  overwritePrefill?: {
    requestId: string
    prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill
  } | null
}

const SKILL_LABELS: ContentDetailDialogLabels = {
  singular: "Skill",
  deleteConfirmTitle: "确认删除这条 Skill？",
  deleteConfirmDescription: "内容将移入「最近删除」，90 天后自动永久清除。",
  deleteLoading: "正在删除 Skill...",
  deleteError: "删除 Skill 失败。",
  conflictTitle: "有人在你之后改过这条 Skill",
  conflictDescription: (name, time) =>
    `${name} 在 ${time} 改过这条 Skill。你的修改会成为最新版本。`,
  emptyDescription: "它可能已经被删除。",
  emptyTitle: "找不到这条 Skill",
  errorTitle: "无法显示 Skill",
  loadingTitle: "正在读取 Skill",
}

function SkillDetailDialog({
  item,
  onContentChanged,
  onOpenChange,
  open,
  refreshSignal = 0,
  overwritePrefill = null,
}: SkillDetailDialogProps) {
  return (
    <ContentDetailDialog
      contentType="skill"
      item={item}
      labels={SKILL_LABELS}
      logCategory="skills.detail"
      onContentChanged={onContentChanged}
      onOpenChange={onOpenChange}
      open={open}
      refreshSignal={refreshSignal}
      overwritePrefill={overwritePrefill}
      renderCreateDialog={(props) => <SkillCreateDialog {...props} />}
      renderVersionView={({ mode, version }) => (
        <SkillVersionView
          mode={mode}
          surface="plain"
          version={version}
        />
      )}
      headerSubtitle={(resolved) => resolved.usage || "暂无使用说明"}
      buildInitialValue={(detail: SynapseContentDetail): CreateSkillPayload => ({
        title: detail.title,
        name: detail.name ?? "",
        usage: detail.usage ?? "",
        description: detail.description,
        category: detail.category,
        icon: detail.icon,
        iconBg: detail.iconBg,
        iconType: detail.iconType || "icon",
        iconImage: detail.iconImage || "",
        content: detail.content,
        files: detail.attachments.map((attachment) => ({
          originalName: attachment.originalName,
          sha256: attachment.sha256,
          size: attachment.size,
        })),
      })}
      serializePayload={async (payload) => ({
        ...payload,
        files: await serializeCreateSkillFiles(payload.files),
      })}
    />
  )
}

export { SkillDetailDialog }
