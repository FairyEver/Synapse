import { useEffect } from "react"
import {
  subscribeContentOpenRequest,
  type ContentOpenRequest,
} from "@/app-shell/content-navigation"
import { DatabaseModule } from "@/modules/database"
import { EditorScanModule } from "@/modules/editor-scan"
import { GitModule } from "@/modules/git"
import { ModelPriceModule } from "@/modules/model-price"
import { ResourceRepositoryModule } from "@/modules/resource-repository"
import { UsageMonitorModule } from "@/modules/usage-analysis"
import { DocumentTemplateModule } from "../../../../app-capabilities/document-template/renderer"
import type { SynapseSystemAppId } from "../types"

type SystemAppContentProps = {
  readonly appId: SynapseSystemAppId
  readonly resourceContentOpenRequest?: ContentOpenRequest | null
  readonly onResourceContentOpenRequestConsumed?: (requestId: string) => void
  readonly onContentOpenRequest?: (request: ContentOpenRequest) => void
}

function SystemAppContent({
  appId,
  resourceContentOpenRequest = null,
  onResourceContentOpenRequestConsumed,
  onContentOpenRequest,
}: SystemAppContentProps) {
  useEffect(() => {
    if (appId === "resource-repository" || !onContentOpenRequest) return undefined
    return subscribeContentOpenRequest(onContentOpenRequest)
  }, [appId, onContentOpenRequest])

  if (appId === "resource-repository") {
    return (
      <ResourceRepositoryModule
        initialContentOpenRequest={resourceContentOpenRequest}
        onInitialContentOpenRequestConsumed={onResourceContentOpenRequestConsumed}
      />
    )
  }
  if (appId === "database") return <DatabaseModule />
  if (appId === "document-template") return <DocumentTemplateModule />
  if (appId === "git") return <GitModule />
  if (appId === "editor-scan") return <EditorScanModule />
  if (appId === "usage-monitor") return <UsageMonitorModule />
  if (appId === "model-price") return <ModelPriceModule />

  return null
}

export { SystemAppContent }
