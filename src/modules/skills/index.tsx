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
  onInstallDialogOpenChange?: (open: boolean) => void
}

function SkillsModule({
  onCreateDialogOpenChange,
  onDetailDialogOpenChange,
  onInstallDialogOpenChange,
}: SkillsModuleProps) {
  const logger = useMemo(() => createRendererLogger("skills"), [])
  const { activeRepository, config } = useAppConfig()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
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

    logger.info("Skill submitted for review.", {
      attachmentCount: payload.files.length,
      branchName: result.branchName ?? null,
      contentId: result.id,
      repositoryUuid: activeRepository?.uuid ?? null,
      targetBranch: result.targetBranch ?? null,
    })
    setRefreshSignal((currentSignal) => currentSignal + 1)
    setNotice(result.message ?? "已提交审核，列表已刷新。")
  }

  return (
    <>
      <ContentBrowserPage
        contentType="skill"
        notice={notice ? { message: notice, onDismiss: () => setNotice(null) } : undefined}
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
