import { useEffect, useMemo, useState } from "react"
import { createRule } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
import type { CreateRulePayload } from "@/modules/rules/types"

type RulesModuleProps = {
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
}

function RulesModule({
  onCreateDialogOpenChange,
  onDetailDialogOpenChange,
}: RulesModuleProps) {
  const logger = useMemo(() => createRendererLogger("rules"), [])
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

  const handleSubmit = async (payload: CreateRulePayload) => {
    logger.info("Rule create payload prepared.", {
      repositoryUuid: activeRepository?.uuid ?? null,
      authorDisplayName: config.global.displayName || null,
      payload,
    })

    const result = await createRule(payload)

    logger.info("Rule content written to repository.", {
      contentId: result.id,
      repositoryUuid: activeRepository?.uuid ?? null,
    })
    setRefreshSignal((currentValue) => currentValue + 1)
  }

  return (
    <>
      <ContentBrowserPage
        contentType="rule"
        refreshSignal={refreshSignal}
        title="Rules"
        onCreateClick={() => setIsCreateDialogOpen(true)}
        onDetailDialogOpenChange={onDetailDialogOpenChange}
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
