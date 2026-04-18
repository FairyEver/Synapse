import { useMemo } from "react"
import { createRule } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { useContentCreationState } from "@/modules/content/hooks/use-content-creation-state"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
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
  const {
    dismissNotice,
    handleCreated,
    isCreateDialogOpen,
    notice,
    refreshSignal,
    setIsCreateDialogOpen,
  } = useContentCreationState(onCreateDialogOpenChange)

  const handleSubmit = async (payload: CreateRulePayload) => {
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

    if (result.status === "saved") {
      handleCreated(result.message)
    }
  }

  return (
    <>
      <ContentBrowserPage
        contentType="rule"
        notice={notice ? { message: notice, onDismiss: dismissNotice } : undefined}
        refreshSignal={refreshSignal}
        title="Rules"
        onCreateClick={() => setIsCreateDialogOpen(true)}
        onDetailDialogOpenChange={onDetailDialogOpenChange}
        onInstallDialogOpenChange={onInstallDialogOpenChange}
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
