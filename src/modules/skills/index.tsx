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

    logger.info("Skill submitted for review.", {
      attachmentCount: payload.files.length,
      branchName: result.branchName ?? null,
      contentId: result.id,
      repositoryUuid: activeRepository?.uuid ?? null,
      targetBranch: result.targetBranch ?? null,
    })

    window.setTimeout(() => {
      window.alert(result.message ?? "提交成功，等待审核。")
    }, 0)
  }

  return (
    <>
      <ContentBrowserPage
        contentType="skill"
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
