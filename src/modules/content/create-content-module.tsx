import { type ComponentType, useMemo } from "react"
import { createContent } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
import { getContentTypeDefinition } from "@/config/content-types"
import { ContentBrowserPage } from "@/modules/content/components/content-browser-page"
import { useContentCreationState } from "@/modules/content/hooks/use-content-creation-state"
import type { SynapseContentMeta, SynapseContentType, SynapseCreateContentPayload } from "@/types/content"

type ContentModuleConfig<T extends SynapseContentType> = {
  contentType: T
  CreateDialog: ComponentType<{
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (payload: SynapseCreateContentPayload<T>) => void
    submitDisabled?: boolean
    submitDisabledReason?: string | null
  }>
  DetailDialog: ComponentType<{
    item: SynapseContentMeta<T> | null
    open: boolean
    refreshSignal: number
    onContentChanged: () => void
    onOpenChange: (open: boolean) => void
  }>
  transformCreatePayload?: (
    payload: SynapseCreateContentPayload<T>,
  ) => Promise<SynapseCreateContentPayload<T>>
}

type ContentModuleProps = {
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
  onInstallDialogOpenChange?: (open: boolean) => void
}

function createContentModule<T extends SynapseContentType>(config: ContentModuleConfig<T>) {
  const definition = getContentTypeDefinition(config.contentType)

  function ContentModule({
    onCreateDialogOpenChange,
    onDetailDialogOpenChange,
    onInstallDialogOpenChange,
  }: ContentModuleProps) {
    const logger = useMemo(() => createRendererLogger(config.contentType), [config.contentType])
    const { activeRepository } = useAppConfig()
    const { currentRepoProfileState } = useCurrentRepoProfile()
    const { promise } = useAppNotifications()
    const { operations, waitForBackgroundPush } = useRepositoryManager()
    const {
      handleCreated,
      isCreateDialogOpen,
      refreshSignal,
      setIsCreateDialogOpen,
    } = useContentCreationState(onCreateDialogOpenChange)
    const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] : null
    const isRepositoryInitializing =
      activeRepositoryOperation?.isRunning
      && activeRepositoryOperation.operation === "initialize"

    const handleSubmit = (payload: SynapseCreateContentPayload<T>) => {
      void promise(
        async () => {
          const finalPayload = config.transformCreatePayload
            ? await config.transformCreatePayload(payload)
            : payload
          const result = await createContent(config.contentType, finalPayload)

          if (result.status !== "saved") {
            return result
          }

          handleCreated()

          if (result.pendingPushCount > 0 && activeRepository) {
            await waitForBackgroundPush(activeRepository.uuid)
          }

          return result
        },
        {
          loading: "正在保存...",
          success: (result) => {
            if (result.status === "saved") {
              return result.pendingPushCount > 0 ? "已保存并同步。" : "保存成功。"
            }

            return null
          },
          error: (error) => error instanceof Error ? error.message : "保存失败。",
        },
      ).catch((error) => {
        logger.error(`${definition.singularLabel} save failed from create dialog.`, {
          repositoryUuid: activeRepository?.uuid ?? null,
          error,
        })
      })
    }

    const submitDisabledReason =
      currentRepoProfileState?.status === "needs-onboarding"
        ? "请先完成当前目录的身份设置"
        : isRepositoryInitializing
          ? "当前目录正在初始化，请稍后。"
        : null

    return (
      <>
        <ContentBrowserPage
          contentType={config.contentType}
          refreshSignal={refreshSignal}
          onCreateClick={() => setIsCreateDialogOpen(true)}
          onDetailDialogOpenChange={onDetailDialogOpenChange}
          onInstallDialogOpenChange={onInstallDialogOpenChange}
          renderDetailDialog={({ item, onContentChanged, onOpenChange, open, refreshSignal: detailRefreshSignal }) => (
            <config.DetailDialog
              item={item?.type === config.contentType ? item as SynapseContentMeta<T> : null}
              open={open}
              refreshSignal={detailRefreshSignal}
              onContentChanged={onContentChanged}
              onOpenChange={onOpenChange}
            />
          )}
        />

        <config.CreateDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          onSubmit={handleSubmit}
          submitDisabled={submitDisabledReason !== null}
          submitDisabledReason={submitDisabledReason}
        />
      </>
    )
  }

  return ContentModule
}

export { createContentModule }
