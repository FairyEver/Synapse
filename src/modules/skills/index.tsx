import { useMemo } from "react"
import { createSkill } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { useContentCreationState } from "@/modules/content/hooks/use-content-creation-state"
import { SkillDetailDialog } from "@/modules/skills/components/skill-detail-dialog"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import type { CreateSkillPayload } from "@/modules/skills/types"
import { serializeCreateSkillFiles } from "@/modules/skills/utils"

type SkillsModuleProps = {
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
  onInstallDialogOpenChange?: (open: boolean) => void
}

function SkillsModule({
  onCreateDialogOpenChange,
  onDetailDialogOpenChange,
  onInstallDialogOpenChange,
}: SkillsModuleProps) {
  const logger = useMemo(() => createRendererLogger("skills"), [])
  const { activeRepository } = useAppConfig()
  const { promise } = useAppNotifications()
  const { waitForBackgroundPush } = useRepositoryManager()
  const {
    handleCreated,
    isCreateDialogOpen,
    refreshSignal,
    setIsCreateDialogOpen,
  } = useContentCreationState(onCreateDialogOpenChange)

  const handleSubmit = (payload: CreateSkillPayload) => {
    void promise(
      async () => {
        logger.info("Skill create payload prepared.", {
          repositoryUuid: activeRepository?.uuid ?? null,
          payload: {
            ...payload,
            files: payload.files.map((file) => ({
              originalName: file.originalName,
              sha256: file.sha256,
              size: file.size,
            })),
          },
        })

        const result = await createSkill({
          ...payload,
          files: await serializeCreateSkillFiles(payload.files),
        })

        logger.info("Skill saved.", {
          attachmentCount: payload.files.length,
          contentId: result.id,
          pendingPushCount: result.status === "saved" ? result.pendingPushCount : null,
          repositoryUuid: activeRepository?.uuid ?? null,
        })

        if (result.status === "saved" && result.pendingPushCount > 0 && activeRepository) {
          await waitForBackgroundPush(activeRepository.uuid)
        }

        return result
      },
      {
        loading: "正在保存...",
        success: (result) => {
          if (result.status === "saved") {
            handleCreated()
            return "保存成功。"
          }

          return null
        },
        error: (error) => error instanceof Error ? error.message : "保存失败。",
      },
    ).catch((error) => {
      logger.error("Skill save failed from create dialog.", {
        repositoryUuid: activeRepository?.uuid ?? null,
        error,
      })
    })
  }

  return (
    <>
      <ContentBrowserPage
        contentType="skill"
        refreshSignal={refreshSignal}
        title="Skills"
        onCreateClick={() => setIsCreateDialogOpen(true)}
        onDetailDialogOpenChange={onDetailDialogOpenChange}
        onInstallDialogOpenChange={onInstallDialogOpenChange}
        renderDetailDialog={({ item, onContentChanged, onOpenChange, open, refreshSignal: detailRefreshSignal }) => (
          <SkillDetailDialog
            item={item?.type === "skill" ? item : null}
            open={open}
            refreshSignal={detailRefreshSignal}
            onContentChanged={onContentChanged}
            onOpenChange={onOpenChange}
          />
        )}
      />

      <SkillCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSubmit={handleSubmit}
      />
    </>
  )
}

export { SkillsModule }
