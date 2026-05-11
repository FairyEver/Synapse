import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  ContentOpenRequest,
  EditOverwriteRulePrefill,
  EditOverwriteSkillPrefill,
} from "@/app-shell/content-navigation"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { ensureBodyInteractable } from "@/app-shell/dialog-navigate"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useActiveRepository, useContentList } from "@/app-shell/use-repository-manager"
import { getContentTypeDefinition } from "@/config/content-types"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { InstallStatusProvider } from "@/modules/content/contexts/install-status-context"
import type { ContentCreateNotice } from "@/modules/content/types/create-notice"
import type { SynapseContentMeta, SynapseContentType, SynapseCreateContentPayload } from "@/types/content"

type ContentModuleConfig<T extends SynapseContentType> = {
  contentType: T
  CreateDialog: ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (payload: SynapseCreateContentPayload<T>) => void
    submitDisabled?: boolean
    submitDisabledReason?: string | null
    existingNames?: string[]
    initialValue?: SynapseCreateContentPayload<T> | null
    notices?: ContentCreateNotice[]
    sourceLabel?: string | null
  }>
  DetailDialog: ComponentType<{
    item: SynapseContentMeta<T> | null
    open: boolean
    refreshSignal?: number
    onContentChanged?: () => void
    onOpenChange: (open: boolean) => void
    overwritePrefill?: {
      requestId: string
      prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill
    } | null
  }>
  transformCreatePayload?: (
    payload: SynapseCreateContentPayload<T>,
  ) => Promise<SynapseCreateContentPayload<T>>
}

type ContentModuleProps = {
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
  onInstallDialogOpenChange?: (open: boolean) => void
  pendingContentOpenRequest?: ContentOpenRequest | null
  onPendingContentOpenRequestConsumed?: (requestId: string) => void
}

function createContentModule<T extends SynapseContentType>(config: ContentModuleConfig<T>) {
  const definition = getContentTypeDefinition(config.contentType)

  function ContentModule({
    onCreateDialogOpenChange,
    onDetailDialogOpenChange,
    onInstallDialogOpenChange,
    pendingContentOpenRequest,
    onPendingContentOpenRequestConsumed,
  }: ContentModuleProps) {
    const logger = useMemo(() => createRendererLogger(config.contentType), [config.contentType])
    const activeRepository = useActiveRepository()
    const { currentRepoProfileState } = useCurrentRepoProfile()
    const { promise } = useAppNotifications()
    const { createContent, items } = useContentList<T>(config.contentType)
    const existingNames = useMemo(
      () => items.filter((item) => item.source !== "builtin" && item.name).map((item) => item.name!),
      [items],
    )
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
    const [createInitialValue, setCreateInitialValue] =
      useState<SynapseCreateContentPayload<T> | null>(null)
    const [createNotices, setCreateNotices] = useState<ContentCreateNotice[]>([])
    const [createSourceLabel, setCreateSourceLabel] = useState<string | null>(null)
    const consumedRequestIdRef = useRef<string | null>(null)

    const handleCreateDialogOpenChange = useCallback((nextOpen: boolean) => {
      if (!nextOpen) {
        setCreateInitialValue(null)
        setCreateNotices([])
        setCreateSourceLabel(null)
      }
      setIsCreateDialogOpen(nextOpen)
      onCreateDialogOpenChange?.(nextOpen)
    }, [onCreateDialogOpenChange])

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
      setCreateInitialValue(request.initialValue as SynapseCreateContentPayload<T>)
      setCreateNotices(request.notices ?? [])
      setCreateSourceLabel(request.sourceLabel)
      // Guard against Radix DismissableLayer originalBodyPointerEvents pollution.
      // See desktop/src/app-shell/dialog-navigate.ts for context.
      ensureBodyInteractable()
      setIsCreateDialogOpen(true)
      onCreateDialogOpenChange?.(true)
      onPendingContentOpenRequestConsumed?.(request.requestId)
    }, [
      onCreateDialogOpenChange,
      onPendingContentOpenRequestConsumed,
      pendingContentOpenRequest,
    ])

    const handleSubmit = async (payload: SynapseCreateContentPayload<T>): Promise<void> => {
      logger.info("Content create submitted.", { contentType: config.contentType, repositoryUuid: activeRepository?.uuid ?? null })
      const finalPayload = config.transformCreatePayload
        ? await config.transformCreatePayload(payload)
        : payload
      const result = await promise(
        () => createContent(finalPayload),
        {
          loading: "正在保存...",
          success: (result) => {
            if (result.status === "saved") {
              return result.pendingPushCount > 0 ? "已保存，等待同步。" : "保存成功。"
            }

            return null
          },
          error: (error) => error instanceof Error ? error.message : "保存失败。",
        },
      )
      if (result?.status !== "saved") {
        throw new Error("保存未完成，请重试。")
      }
    }

    const submitDisabledReason =
      currentRepoProfileState?.status === "needs-onboarding"
        ? "请先完成当前目录的身份设置"
        : null

    return (
      <InstallStatusProvider>
        <ContentBrowserPage
          contentType={config.contentType}
          pendingContentOpenRequest={pendingContentOpenRequest}
          onPendingContentOpenRequestConsumed={onPendingContentOpenRequestConsumed}
          onCreateClick={() => {
            setCreateInitialValue(null)
            setCreateNotices([])
            setCreateSourceLabel(null)
            handleCreateDialogOpenChange(true)
          }}
          onCreateDialogOpenChange={onCreateDialogOpenChange}
          onDetailDialogOpenChange={onDetailDialogOpenChange}
          onInstallDialogOpenChange={onInstallDialogOpenChange}
          renderDetailDialog={({ item, onOpenChange, open, overwritePrefill }) => (
            <config.DetailDialog
              item={item?.type === config.contentType ? item as SynapseContentMeta<T> : null}
              open={open}
              onOpenChange={onOpenChange}
              overwritePrefill={overwritePrefill}
            />
          )}
        />

        <config.CreateDialog
          open={isCreateDialogOpen}
          onOpenChange={handleCreateDialogOpenChange}
          onSubmit={handleSubmit}
          submitDisabled={submitDisabledReason !== null}
          submitDisabledReason={submitDisabledReason}
          existingNames={existingNames}
          initialValue={createInitialValue}
          notices={createNotices}
          sourceLabel={createSourceLabel}
        />
      </InstallStatusProvider>
    )
  }

  return ContentModule
}

export { createContentModule }
