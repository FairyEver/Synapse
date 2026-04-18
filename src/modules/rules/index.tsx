import { useMemo } from "react"
import { createRule } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { useContentCreationState } from "@/modules/content/hooks/use-content-creation-state"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
import { RuleDetailDialog } from "@/modules/rules/components/rule-detail-dialog"
import type { CreateRulePayload } from "@/modules/rules/types"

type RulesModuleProps = {
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
  onInstallDialogOpenChange?: (open: boolean) => void
}

function RulesModule({
  onCreateDialogOpenChange,
  onDetailDialogOpenChange,
  onInstallDialogOpenChange,
}: RulesModuleProps) {
  const logger = useMemo(() => createRendererLogger("rules"), [])
  const { activeRepository } = useAppConfig()
  const { promise } = useAppNotifications()
  const { waitForBackgroundPush } = useRepositoryManager()
  const {
    handleCreated,
    isCreateDialogOpen,
    refreshSignal,
    setIsCreateDialogOpen,
  } = useContentCreationState(onCreateDialogOpenChange)

  const handleSubmit = (payload: CreateRulePayload) => {
    void promise(
      async () => {
        logger.info("Rule create payload prepared.", {
          repositoryUuid: activeRepository?.uuid ?? null,
          payload,
        })

        const result = await createRule(payload)

        logger.info("Rule saved.", {
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
      logger.error("Rule save failed from create dialog.", {
        repositoryUuid: activeRepository?.uuid ?? null,
        error,
      })
    })
  }

  return (
    <>
      <ContentBrowserPage
        contentType="rule"
        refreshSignal={refreshSignal}
        title="Rules"
        onCreateClick={() => setIsCreateDialogOpen(true)}
        onDetailDialogOpenChange={onDetailDialogOpenChange}
        onInstallDialogOpenChange={onInstallDialogOpenChange}
        renderDetailDialog={({ item, onContentChanged, onOpenChange, open, refreshSignal: detailRefreshSignal }) => (
          <RuleDetailDialog
            item={item?.type === "rule" ? item : null}
            open={open}
            refreshSignal={detailRefreshSignal}
            onContentChanged={onContentChanged}
            onOpenChange={onOpenChange}
          />
        )}
      />

      <RuleCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSubmit={handleSubmit}
      />
    </>
  )
}

export { RulesModule }
