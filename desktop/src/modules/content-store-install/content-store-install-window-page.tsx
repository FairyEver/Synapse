import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, CircleAlert, LogIn, RotateCw } from "lucide-react"
import { recordContentStoreInstallComplete } from "@/app-shell/content-store-install"
import { useAccount } from "@/app-shell/account"
import { useAppConfig } from "@/app-shell/config"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type {
  SynapseContentStoreInstallWindowRequest,
  SynapseContentStorePreparedSource,
} from "@/types/content-store-install"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import { ContentInstallDialog } from "@/modules/content/components/content-install-dialog"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import { ContentStoreInstallLoading } from "./content-store-install-loading"
import { useContentStoreInstall } from "./use-content-store-install"

function toContentMeta(source: SynapseContentStorePreparedSource): SynapseContentMeta {
  const now = new Date(0).toISOString()
  return {
    attachmentCount: source.files.filter((file) => file.path !== source.mainFile).length,
    category: "content-store",
    createdAt: now,
    createdBy: "content-store",
    createdByDisplayName: "Content Store",
    deleted: false,
    description: "",
    icon: "",
    iconBg: "",
    id: source.contentId,
    latestHistoryDirname: source.versionId,
    modifiedAt: now,
    modifiedBy: "content-store",
    modifiedByDisplayName: "Content Store",
    title: source.title,
    type: source.type,
  } as SynapseContentMeta
}

function ContentStoreInstallWindowPage({ request }: { request: SynapseContentStoreInstallWindowRequest }) {
  const { config } = useAppConfig()
  const account = useAccount()
  const { load, markCompleted, state } = useContentStoreInstall(request.session)
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const source = state.status === "ready" ? state.source : null
  const item = useMemo(() => source ? toContentMeta(source) : null, [source])
  const adapters = useEditorAdaptersForContentType({
    contentType: source?.type ?? "skill",
    enabled: Boolean(source),
    loggerName: "content-store-install.editors",
  })
  const {
    error: editorError,
    filteredAdapters,
    isLoading: isLoadingEditors,
    load: loadEditors,
  } = adapters

  const resetAndLoad = useCallback(async () => {
    setSelectedEditor(null)
    setDialogOpen(false)
    await load()
  }, [load])

  useEffect(() => {
    if (!source) return
    void loadEditors()
  }, [loadEditors, source])

  const retry = useCallback(() => {
    void resetAndLoad()
  }, [resetAndLoad])

  const startLogin = useCallback(async () => {
    await account.startLogin()
    await resetAndLoad()
  }, [account, resetAndLoad])

  const handleInstalled = useCallback(async () => {
    await recordContentStoreInstallComplete(request.session)
    setDialogOpen(false)
    markCompleted(source?.title ?? "内容")
  }, [markCompleted, request.session, source?.title])

  return (
    <main className="flex min-h-screen bg-background px-6 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-medium text-foreground">安装内容</h1>
            {source ? <p className="truncate text-sm text-muted-foreground">{source.title}</p> : null}
          </div>
          {state.status === "loading" ? <Spinner className="size-5 text-muted-foreground" /> : null}
        </header>

        {state.status === "loading" ? (
          <ContentStoreInstallLoading />
        ) : null}

        {state.status === "unauthenticated" ? (
          <InstallStateMessage
            icon={<LogIn />}
            title="需要登录"
            action={<Button onClick={startLogin}>登录</Button>}
          />
        ) : null}

        {state.status === "error" ? (
          <InstallStateMessage
            icon={<CircleAlert />}
            title={state.message}
            action={(
              <Button variant="outline" onClick={retry}>
                <RotateCw />
                重试
              </Button>
            )}
          />
        ) : null}

        {state.status === "completed" ? (
          <InstallStateMessage
            icon={<CheckCircle2 />}
            title="已安装"
            description={state.title}
          />
        ) : null}

        {source && item && state.status === "ready" ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-foreground">选择编辑器</h2>
            {editorError ? <p className="text-sm text-destructive">{editorError}</p> : null}
            {isLoadingEditors ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner />
                正在读取编辑器
              </div>
            ) : null}
            {!isLoadingEditors && filteredAdapters.length === 0 ? (
              <p className="text-sm text-muted-foreground">没有可用编辑器。</p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {filteredAdapters.map((editor) => (
                <Button
                  key={editor.id}
                  type="button"
                  variant="outline"
                  className="h-auto justify-start py-3 text-left"
                  onClick={() => {
                    setSelectedEditor(editor)
                    setDialogOpen(true)
                  }}
                >
                  {editor.label}
                </Button>
              ))}
            </div>
            <ContentInstallDialog
              editor={selectedEditor}
              initialContent={source.mainContent}
              item={item}
              onInstalled={handleInstalled}
              onOpenChange={setDialogOpen}
              open={dialogOpen}
              preparedSourceId={source.id}
              projects={config.global.projects}
            />
          </section>
        ) : null}
      </div>
    </main>
  )
}

function InstallStateMessage({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode
  description?: string
  icon: ReactNode
  title: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

export { ContentStoreInstallWindowPage, toContentMeta }
