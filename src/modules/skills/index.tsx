import { useMemo } from "react"
import { createSkill } from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { useContentCreationState } from "@/modules/content/hooks/use-content-creation-state"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import type { CreateSkillPayload } from "@/modules/skills/types"

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
  const {
    dismissNotice,
    handleCreated,
    isCreateDialogOpen,
    notice,
    refreshSignal,
    setIsCreateDialogOpen,
  } = useContentCreationState(onCreateDialogOpenChange)

  const handleSubmit = async (payload: CreateSkillPayload) => {
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
      files: await Promise.all(
        payload.files.map(async (file) => ({
          originalName: file.originalName,
          sha256: file.sha256,
          size: file.size,
          bytes: file.file ? new Uint8Array(await file.file.arrayBuffer()) : undefined,
        })),
      ),
    })

    logger.info("Skill saved.", {
      attachmentCount: payload.files.length,
      contentId: result.id,
      pendingPushCount: result.status === "saved" ? result.pendingPushCount : null,
      repositoryUuid: activeRepository?.uuid ?? null,
    })

    if (result.status === "saved") {
      handleCreated(result.message)
    }
  }

  return (
    <>
      <ContentBrowserPage
        contentType="skill"
        notice={notice ? { message: notice, onDismiss: dismissNotice } : undefined}
        refreshSignal={refreshSignal}
        title="Skills"
        onCreateClick={() => setIsCreateDialogOpen(true)}
        onDetailDialogOpenChange={onDetailDialogOpenChange}
        onInstallDialogOpenChange={onInstallDialogOpenChange}
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
