import { useEffect, useMemo, useState } from "react"
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

  useEffect(() => {
    onCreateDialogOpenChange?.(isCreateDialogOpen)
  }, [isCreateDialogOpen, onCreateDialogOpenChange])

  useEffect(() => {
    return () => {
      onCreateDialogOpenChange?.(false)
    }
  }, [onCreateDialogOpenChange])

  const handleSubmit = (payload: CreateRulePayload) => {
    logger.info("Rule create payload prepared.", {
      repositoryUuid: activeRepository?.uuid ?? null,
      authorDisplayName: config.global.displayName || null,
      payload,
    })
  }

  return (
    <>
      <ContentBrowserPage
        contentType="rule"
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
