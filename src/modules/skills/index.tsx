import { useEffect, useMemo, useState } from "react"
import { createSkill } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import type { CreateSkillPayload } from "@/modules/skills/types"

type SkillsModuleProps = {
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
}

function SkillsModule({
  onCreateDialogOpenChange,
  onDetailDialogOpenChange,
}: SkillsModuleProps) {
  const logger = useMemo(() => createRendererLogger("skills"), [])
  const { activeRepository, config } = useAppConfig()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)

  useEffect(() => {
    onCreateDialogOpenChange?.(isCreateDialogOpen)
  }, [isCreateDialogOpen, onCreateDialogOpenChange])

  useEffect(() => {
    return () => {
      onCreateDialogOpenChange?.(false)
    }
  }, [onCreateDialogOpenChange])

  const handleSubmit = async (payload: CreateSkillPayload) => {
    logger.info("Skill create payload prepared.", {
      repositoryUuid: activeRepository?.uuid ?? null,
      authorDisplayName: config.global.displayName || null,
      payload: {
        ...payload,
        files: payload.files.map((file) => ({
          relativePath: file.relativePath,
          size: file.size,
        })),
      },
    })

    const result = await createSkill({
      ...payload,
      files: await Promise.all(
        payload.files.map(async (file) => ({
          relativePath: file.relativePath,
          size: file.size,
          bytes: new Uint8Array(await file.file.arrayBuffer()),
        })),
      ),
    })

    logger.info("Skill content written to repository.", {
      attachmentCount: payload.files.length,
      contentId: result.id,
      repositoryUuid: activeRepository?.uuid ?? null,
    })
    setRefreshSignal((currentValue) => currentValue + 1)
  }

  return (
    <>
      <ContentBrowserPage
        contentType="skill"
        refreshSignal={refreshSignal}
        title="Skills"
        onCreateClick={() => setIsCreateDialogOpen(true)}
        onDetailDialogOpenChange={onDetailDialogOpenChange}
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
