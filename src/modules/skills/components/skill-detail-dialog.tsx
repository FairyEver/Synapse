import {
  ContentDetailDialog,
  type ContentDetailDialogLabels,
} from "@/modules/content/components/content-detail-dialog"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import { SkillVersionView } from "@/modules/skills/components/skill-version-view"
import type { CreateSkillPayload } from "@/modules/skills/types"
import { serializeCreateSkillFiles } from "@/modules/skills/utils"
import type { SynapseContentDetail, SynapseSkillMeta } from "@/types/content"
import type { SynapseLoadedContentVersion } from "@/modules/content/hooks/use-content-detail-state"

type SkillDetailDialogProps = {
  item: SynapseSkillMeta | null
  onContentChanged?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  refreshSignal?: number
}

const SKILL_LABELS: ContentDetailDialogLabels = {
  singular: "Skill",
  deleteConfirmTitle: "确认删除这条 Skill？",
  deleteConfirmDescription: "删除后，这条 Skill 会从列表里隐藏，但历史记录仍会保留在仓库里。",
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
}: SkillDetailDialogProps) {
  return (
    <ContentDetailDialog<CreateSkillPayload>
      contentType="skill"
      item={item}
      labels={SKILL_LABELS}
      logCategory="skills.detail"
      onContentChanged={onContentChanged}
      onOpenChange={onOpenChange}
      open={open}
      refreshSignal={refreshSignal}
      renderCreateDialog={(props) => <SkillCreateDialog {...props} />}
      renderVersionView={({ mode, version }) => (
        <SkillVersionView
          mode={mode}
          version={version as unknown as SynapseLoadedContentVersion<"skill">}
        />
      )}
      buildInitialValue={(detail: SynapseContentDetail): CreateSkillPayload => ({
        title: detail.title,
        name: detail.name ?? "",
        description: detail.description,
        category: detail.category,
        icon: detail.icon,
        iconBg: detail.iconBg,
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
