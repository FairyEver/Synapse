import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react"
import { CheckCircle2, CircleAlert, LogIn, RotateCw } from "lucide-react"
import { recordSkillRepositoryInstallComplete } from "@/app-shell/skill-repository-install"
import { useAccount } from "@/app-shell/account"
import { useAppConfig } from "@/app-shell/config"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { normalizeSkillNameInput, validateSkillNameInput } from "@/lib/skill-name-input"
import type {
  SynapseSkillRepositoryInstallWindowRequest,
  SynapseSkillRepositoryPreparedSource,
} from "@/types/skill-repository-install"
import type { SynapseInstallerSource } from "@/types/installers"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import { SharedInstallerFlow } from "@/modules/installers/shared/shared-installer-flow"
import { ContentStoreInstallLoading } from "@/modules/content-store-install/content-store-install-loading"
import { useSkillRepositoryInstall } from "./use-skill-repository-install"

function SkillRepositoryInstallWindowPage({ request }: { request: SynapseSkillRepositoryInstallWindowRequest }) {
  const { config } = useAppConfig()
  const account = useAccount()
  const { load, markCompleted, state } = useSkillRepositoryInstall(request.session)
  const authenticatedRetrySessionRef = useRef<string | null>(null)

  const source = state.status === "ready" ? state.source : null
  const installerSource = useMemo(() => source ? toInstallerSource(source) : null, [source])
  const adapters = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: Boolean(source),
    loggerName: "skill-repository-install.editors",
  })
  const {
    error: editorError,
    filteredAdapters,
    isLoading: isLoadingEditors,
    load: loadEditors,
  } = adapters

  const resetAndLoad = useCallback(async () => {
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
    const nextState = await account.startLogin()
    if (nextState.status === "authenticated") {
      await resetAndLoad()
    }
  }, [account, resetAndLoad])

  useEffect(() => {
    if (account.state.status !== "authenticated") {
      authenticatedRetrySessionRef.current = null
      return
    }
    if (state.status !== "unauthenticated") return
    if (authenticatedRetrySessionRef.current === request.session) return
    authenticatedRetrySessionRef.current = request.session
    void resetAndLoad()
  }, [account.state.status, request.session, resetAndLoad, state.status])

  const handleInstalled = useCallback(async () => {
    await recordSkillRepositoryInstallComplete(request.session)
    markCompleted(source?.title ?? "Skill")
  }, [markCompleted, request.session, source?.title])

  return (
    <main className="flex min-h-screen bg-background px-6 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-medium text-foreground">Install Skill</h1>
            {source ? <p className="truncate text-sm text-muted-foreground">{source.ownerHandle}/{source.repositoryName}</p> : null}
          </div>
          {state.status === "loading" ? <Spinner className="size-5 text-muted-foreground" /> : null}
        </header>

        {state.status === "loading" ? <ContentStoreInstallLoading /> : null}

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

        {source && installerSource && state.status === "ready" ? (
          <section className="flex flex-col gap-3">
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
            <SharedInstallerFlow
              editors={filteredAdapters}
              mode="page"
              projects={config.global.projects}
              source={installerSource}
              onCancel={() => undefined}
              onInstalled={handleInstalled}
            />
          </section>
        ) : null}
      </div>
    </main>
  )
}

function toInstallerSource(source: SynapseSkillRepositoryPreparedSource): SynapseInstallerSource {
  const name = choosePreparedSourceName(source)
  return {
    kind: "skill",
    origin: "prepared",
    preparedSourceId: source.id,
    sourceIdentity: source.repositoryId,
    name,
    title: source.title,
    description: "",
    mainContent: source.mainContent,
  }
}

function choosePreparedSourceName(source: SynapseSkillRepositoryPreparedSource): string {
  for (const candidate of [source.repositoryName, source.title, source.repositoryId, source.id]) {
    const normalized = normalizeSkillNameInput(candidate)
    if (!validateSkillNameInput(normalized)) {
      return normalized
    }
  }

  return "skill"
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

export { SkillRepositoryInstallWindowPage }
