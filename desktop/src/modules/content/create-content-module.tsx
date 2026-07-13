import { useCallback, useEffect, useMemo, useRef } from "react"
import { openContentCreateWindow } from "@/app-shell/content"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { ensureBodyInteractable } from "@/app-shell/dialog-navigate"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { getContentTypeDefinition } from "@/config/content-types"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { InstallStatusProvider } from "@/modules/content/contexts/install-status-context"
import type { ContentCreateNotice } from "@/modules/content/types/create-notice"
import type { SynapseContentType, SynapseCreateContentPayload } from "@/types/content"

type ContentModuleConfig<T extends SynapseContentType> = {
  contentType: T
}

type ContentModuleProps = {
  hasBlockingModalOpen?: boolean
  onInstallDialogOpenChange?: (open: boolean) => void
  pendingContentOpenRequest?: ContentOpenRequest | null
  onPendingContentOpenRequestConsumed?: (requestId: string) => void
}

function createContentModule<T extends SynapseContentType>(config: ContentModuleConfig<T>) {
  const definition = getContentTypeDefinition(config.contentType)

  function ContentModule({
    hasBlockingModalOpen = false,
    onInstallDialogOpenChange,
    pendingContentOpenRequest,
    onPendingContentOpenRequestConsumed,
  }: ContentModuleProps) {
    const logger = useMemo(() => createRendererLogger(config.contentType), [config.contentType])
    const activeRepository = useActiveRepository()
    const { error: notifyError } = useAppNotifications()
    const consumedRequestIdRef = useRef<string | null>(null)

    const openCreateEditorWindow = useCallback(async (input: {
      initialValue?: SynapseCreateContentPayload<T> | null
      notices?: ContentCreateNotice[]
      quickPublishSessionId?: string
      requestId?: string
      sourceLabel?: string | null
    } = {}) => {
      try {
        await openContentCreateWindow({
          contentType: config.contentType,
          initialValue: input.initialValue,
          notices: input.notices,
          quickPublishSessionId: input.quickPublishSessionId,
          requestId: input.requestId,
          sourceLabel: input.sourceLabel,
          title: `新建 ${definition.singularLabel}`,
        })
      } catch (error) {
        logger.error("Failed to open content create window.", {
          contentType: config.contentType,
          error,
          repositoryUuid: activeRepository?.uuid ?? null,
        })
        notifyError(error instanceof Error ? error.message : "打开新建窗口失败。")
      }
    }, [activeRepository?.uuid, config.contentType, definition.singularLabel, logger, notifyError])

    useEffect(() => {
      const request = pendingContentOpenRequest
      if (
        !request
        || request.contentType !== config.contentType
        || request.kind !== "create"
        || consumedRequestIdRef.current === request.requestId
      ) {
        return
      }

      consumedRequestIdRef.current = request.requestId
      // Guard against Radix DismissableLayer originalBodyPointerEvents pollution.
      // See desktop/src/app-shell/dialog-navigate.ts for context.
      ensureBodyInteractable()
      void openCreateEditorWindow({
        initialValue: request.initialValue as SynapseCreateContentPayload<T>,
        notices: request.notices,
        quickPublishSessionId: request.quickPublishSessionId,
        requestId: request.requestId,
        sourceLabel: request.sourceLabel,
      })
      onPendingContentOpenRequestConsumed?.(request.requestId)
    }, [
      onPendingContentOpenRequestConsumed,
      openCreateEditorWindow,
      pendingContentOpenRequest,
    ])

    return (
      <InstallStatusProvider>
        <ContentBrowserPage
          contentType={config.contentType}
          hasBlockingModalOpen={hasBlockingModalOpen}
          pendingContentOpenRequest={pendingContentOpenRequest}
          onPendingContentOpenRequestConsumed={onPendingContentOpenRequestConsumed}
          onCreateClick={() => {
            logger.info("Content create window requested from module.", {
              contentType: config.contentType,
              repositoryUuid: activeRepository?.uuid ?? null,
            })
            void openCreateEditorWindow()
          }}
          onInstallDialogOpenChange={onInstallDialogOpenChange}
        />
      </InstallStatusProvider>
    )
  }

  return ContentModule
}

export { createContentModule }
