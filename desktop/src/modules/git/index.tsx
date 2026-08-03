import { useCallback, useEffect, useRef, useState } from "react"
import { FolderGit2, Plus, RefreshCw } from "lucide-react"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { SynapseGitEnvironmentState, SynapseGitProvider, SynapseGitRepository, SynapseGitRepositorySnapshot } from "@/types/git"
import { GitAccessPanel } from "./components/git-access-panel"
import { GitAddLocalDialog, GitCloneDialog } from "./components/git-clone-dialog"
import { GitEnvironmentPanel } from "./components/git-environment-panel"
import { GitInstallPanel } from "./components/git-install-panel"
import { useGitRepositoryInitialization, type GitInitializationRetry } from "./components/git-initialize-dialog"
import { GitRepositoryList } from "./components/git-repository-list"
import { useGitPushRemoteSelection } from "./components/git-push-remote-dialog"
import { GitWorkbench } from "./components/git-workbench"
import type { GitOperationFailure } from "./hooks/use-git-operations"
import { useGitAccess } from "./hooks/use-git-access"
import { useGitOperations } from "./hooks/use-git-operations"
import { usePendingGitAction, type PendingGitAction, type PendingGitRepositoryOperation } from "./hooks/use-pending-git-action"
import { useGitRepositories } from "./hooks/use-git-repositories"
import { shouldRouteFailureToAccess } from "./lib/git-failure-view"
import { parseGitRemote } from "./lib/git-remote"

type GitAppViewId = "repositories" | "environment" | "install" | "access"

const GIT_APP_TABS: readonly { readonly id: GitAppViewId; readonly label: string }[] = [
  { id: "repositories", label: "仓库" },
  { id: "environment", label: "环境" },
  { id: "install", label: "安装 Git" },
  { id: "access", label: "访问" },
]

function isAccessProtocol(protocol: string): protocol is "http" | "https" | "ssh" {
  return protocol === "http" || protocol === "https" || protocol === "ssh"
}

function providerFromHost(host: string, protocol: "http" | "https" | "ssh"): SynapseGitProvider {
  const remote = protocol === "ssh" ? `git@${host}:owner/repo.git` : `${protocol}://${host}/owner/repo.git`
  return parseGitRemote(remote).provider
}

function buildClonePendingAction(
  input: { readonly directoryName: string; readonly parentDirectory: string; readonly remoteUrl: string },
  failure: GitOperationFailure,
): PendingGitAction | null {
  if (!shouldRouteFailureToAccess(failure)) return null
  const descriptor = parseGitRemote(input.remoteUrl)
  const host = failure.host ?? descriptor.host
  const protocol = isAccessProtocol(failure.protocol) ? failure.protocol : isAccessProtocol(descriptor.protocol) ? descriptor.protocol : null
  if (!host || !protocol) return null
  return {
    type: "clone",
    host,
    protocol,
    provider: descriptor.provider !== "generic" ? descriptor.provider : providerFromHost(host, protocol),
    port: descriptor.port,
    username: descriptor.username,
    input,
  }
}

function buildRepositoryPendingAction(failure: GitOperationFailure): PendingGitAction | null {
  if (!shouldRouteFailureToAccess(failure)) return null
  if (!failure.repositoryId || !failure.repositoryOperation) return null
  const operation = failure.repositoryOperation
  if (operation !== "pull" && operation !== "push" && operation !== "sync") return null
  if (!failure.host || !isAccessProtocol(failure.protocol)) return null
  return {
    type: operation as PendingGitRepositoryOperation,
    repositoryId: failure.repositoryId,
    host: failure.host,
    port: failure.port ?? null,
    protocol: failure.protocol,
    provider: providerFromHost(failure.host, failure.protocol),
  }
}

function buildInitializationPendingAction(
  failure: GitOperationFailure,
  retry: GitInitializationRetry,
): PendingGitAction | null {
  if (!shouldRouteFailureToAccess(failure)) return null
  if (!failure.host || !isAccessProtocol(failure.protocol)) return null
  return {
    type: "initialize",
    host: failure.host,
    port: failure.port ?? null,
    protocol: failure.protocol,
    provider: providerFromHost(failure.host, failure.protocol),
    repository: retry.repository,
    input: retry.input,
    onCompleted: retry.onCompleted,
  }
}

function pendingActionHosts(pendingAction: PendingGitAction | null) {
  if (!pendingAction) return []
  return [{
    host: pendingAction.host,
    port: pendingAction.port ?? null,
    protocol: pendingAction.protocol,
    provider: pendingAction.provider,
  }]
}

export function GitModule() {
  const [view, setView] = useState<GitAppViewId>("repositories")
  const [selectedRepository, setSelectedRepository] = useState<SynapseGitRepository | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [addLocalOpen, setAddLocalOpen] = useState(false)
  const [environment, setEnvironment] = useState<SynapseGitEnvironmentState | null>(null)
  const [environmentLoading, setEnvironmentLoading] = useState(false)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const [retryPendingBusy, setRetryPendingBusy] = useState(false)
  const retryPendingBusyRef = useRef(false)
  const repositoriesState = useGitRepositories()
  const operations = useGitOperations(repositoriesState.refresh)
  const pushRemoteSelection = useGitPushRemoteSelection()
  const initialization = useGitRepositoryInitialization()
  const access = useGitAccess()
  const {
    pendingAction,
    setPendingAction,
    clearPendingAction,
  } = usePendingGitAction()

  const refreshEnvironment = useCallback(async () => {
    setEnvironmentLoading(true)
    setEnvironmentError(null)
    try {
      const state = await getSynapseBridge()?.git.checkEnvironment()
      setEnvironment(state ?? null)
    } catch (err) {
      setEnvironmentError(err instanceof Error ? err.message : "Git 环境检测失败。")
    } finally {
      setEnvironmentLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!cancelled) await refreshEnvironment()
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [refreshEnvironment])

  useEffect(() => {
    if (environment && !environment.gitAvailable) {
      setView("install")
    }
  }, [environment])

  useEffect(() => {
    if (view !== "access" && !pendingAction) return
    void access.refresh(pendingActionHosts(pendingAction))
  }, [access.refresh, pendingAction, view])

  const routeFailure = useCallback((failure: GitOperationFailure) => {
    if (failure.category === "git-missing" || failure.primaryAction === "install-git") {
      setView("install")
      return
    }
    if (failure.category === "missing-identity" || failure.primaryAction === "set-identity") {
      setView("environment")
      return
    }
    if (shouldRouteFailureToAccess(failure)) {
      setView("access")
      return
    }
    setView("repositories")
  }, [])

  const updatePendingActionFromFailure = useCallback((
    failure: GitOperationFailure,
    fallbackInput?: { readonly directoryName: string; readonly parentDirectory: string; readonly remoteUrl: string },
  ) => {
    const pending = fallbackInput ? buildClonePendingAction(fallbackInput, failure) : buildRepositoryPendingAction(failure)
    if (pending) {
      setPendingAction(pending)
      return
    }
    clearPendingAction()
  }, [clearPendingAction, setPendingAction])

  const handleInitializationFailure = useCallback((failure: GitOperationFailure, retry: GitInitializationRetry) => {
    const pending = buildInitializationPendingAction(failure, retry)
    if (pending) setPendingAction(pending)
    else clearPendingAction()
    routeFailure(failure)
  }, [clearPendingAction, routeFailure, setPendingAction])

  useEffect(() => {
    const failure = operations.lastFailure
    if (!failure) return
    if (failure.globalOperation === "clone") {
      if (!shouldRouteFailureToAccess(failure)) clearPendingAction()
    } else {
      updatePendingActionFromFailure(failure)
    }
    routeFailure(failure)
  }, [clearPendingAction, operations.lastFailure, routeFailure, updatePendingActionFromFailure])

  const retryPendingAction = useCallback(async () => {
    if (retryPendingBusyRef.current) return
    if (!pendingAction) return
    retryPendingBusyRef.current = true
    setRetryPendingBusy(true)
    try {
      if (pendingAction.type === "clone") {
        const result = await operations.cloneRepository(pendingAction.input)
        if (result.ok) {
          clearPendingAction()
          setCloneOpen(false)
          return
        }
        if (result.failure) {
          updatePendingActionFromFailure(result.failure, pendingAction.input)
          routeFailure(result.failure)
          return
        }
        clearPendingAction()
        return
      }

      if (pendingAction.type === "initialize") {
        clearPendingAction()
        setView("repositories")
        await initialization.open({
          repository: pendingAction.repository,
          onCompleted: pendingAction.onCompleted,
          onFailure: handleInitializationFailure,
          preferredMessage: pendingAction.input.message,
          preferredRemote: pendingAction.input.remoteName,
        })
        return
      }

      const runRepositoryOperation: Record<PendingGitRepositoryOperation, (repositoryId: string) => ReturnType<typeof operations.pull>> = {
        pull: operations.pull,
        push: operations.push,
        sync: operations.sync,
      }
      const result = await runRepositoryOperation[pendingAction.type](pendingAction.repositoryId)
      if (result.ok) {
        clearPendingAction()
        return
      }
      if (result.failure) {
        updatePendingActionFromFailure(result.failure)
        routeFailure(result.failure)
        return
      }
      clearPendingAction()
    } finally {
      retryPendingBusyRef.current = false
      setRetryPendingBusy(false)
    }
  }, [clearPendingAction, handleInitializationFailure, initialization, operations, pendingAction, routeFailure, updatePendingActionFromFailure])

  const handleCloneFailure = useCallback((input: { readonly cloneInput: { readonly directoryName: string; readonly parentDirectory: string; readonly remoteUrl: string }; readonly failure: GitOperationFailure }) => {
    if (input.failure.primaryAction === "retry" && (input.failure.category === "network" || input.failure.category === "timeout")) {
      void operations.retry()
      return
    }
    setCloneOpen(false)
    updatePendingActionFromFailure(input.failure, input.cloneInput)
    routeFailure(input.failure)
  }, [operations, routeFailure, updatePendingActionFromFailure])

  const handleWorkbenchOperationFailure = useCallback((failure: GitOperationFailure | null) => {
    if (failure) {
      updatePendingActionFromFailure(failure)
      return
    }
    clearPendingAction()
  }, [clearPendingAction, updatePendingActionFromFailure])

  const handlePush = useCallback(async (
    repositoryId: string,
    trackingStatus: SynapseGitRepositorySnapshot["trackingStatus"],
  ) => {
    const remoteName = await pushRemoteSelection.choose(repositoryId, trackingStatus)
    if (remoteName === null) return
    await operations.push(repositoryId, remoteName)
  }, [operations, pushRemoteSelection])

  const handleFailureAction = useCallback((failure: GitOperationFailure) => {
    if (failure.primaryAction === "retry" && (failure.category === "network" || failure.category === "timeout")) {
      void operations.retry()
      return
    }
    routeFailure(failure)
  }, [operations, routeFailure])

  return (
    <>
      <SystemAppWindowShell
        tabs={GIT_APP_TABS}
        value={view}
        onValueChange={setView}
        actions={view === "repositories" && !selectedRepository ? (
          <>
            <SystemAppTopBarActionButton
              type="button"
              iconOnly
              aria-label="刷新仓库列表"
              onClick={() => void repositoriesState.refresh()}
              disabled={repositoriesState.loading || operations.busy.global !== null}
            >
              <RefreshCw />
            </SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton
              type="button"
              onClick={() => setAddLocalOpen(true)}
              disabled={operations.busy.global !== null}
            >
              <FolderGit2 data-icon="inline-start" />
              添加本地仓库
            </SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton
              type="button"
              onClick={() => setCloneOpen(true)}
              disabled={operations.busy.global !== null}
            >
              <Plus data-icon="inline-start" />
              克隆仓库
            </SystemAppTopBarActionButton>
          </>
        ) : undefined}
      >
        <Tabs value={view} className="contents">
          <TabsContent value="repositories" className="m-0 h-full min-w-0 data-[state=inactive]:hidden">
            {selectedRepository ? (
              <GitWorkbench
                repository={selectedRepository}
                onBack={() => setSelectedRepository(null)}
                onOperationFailure={handleWorkbenchOperationFailure}
                onHandleFailure={routeFailure}
                onInitialize={(repository, onCompleted) => {
                  void initialization.open({ repository, onCompleted, onFailure: handleInitializationFailure })
                }}
                onSelectPushRemote={pushRemoteSelection.choose}
              />
            ) : (
              <GitRepositoryList
                summaries={repositoriesState.summaries}
                loading={repositoriesState.loading}
                error={repositoriesState.error ?? operations.error}
                failure={operations.lastFailure}
                busy={operations.busy}
                onOpenRepository={setSelectedRepository}
                onInitialize={(repository) => {
                  void initialization.open({
                    repository,
                    onCompleted: repositoriesState.refresh,
                    onFailure: handleInitializationFailure,
                  })
                }}
                onPull={(repositoryId) => void operations.pull(repositoryId)}
                onPush={(repositoryId, trackingStatus) => void handlePush(repositoryId, trackingStatus)}
                onSync={(repositoryId) => void operations.sync(repositoryId)}
                onCancel={(repositoryId) => void operations.cancelRepository(repositoryId)}
                onRemoveRepository={(input) => operations.removeRepository(input)}
                onHandleFailure={handleFailureAction}
              />
            )}
          </TabsContent>
          <TabsContent value="environment" className="m-0 h-full min-w-0 data-[state=inactive]:hidden">
            <div className="h-full min-w-0 bg-surface">
              <GitEnvironmentPanel
                environment={environment}
                repositorySummaries={repositoriesState.summaries}
                loading={environmentLoading}
                error={environmentError}
                onRefresh={refreshEnvironment}
              />
            </div>
          </TabsContent>
          <TabsContent value="install" className="m-0 h-full data-[state=inactive]:hidden">
            <GitInstallPanel
              environment={environment}
              repositorySummaries={repositoriesState.summaries}
              loading={environmentLoading}
              error={environmentError}
              onRefresh={refreshEnvironment}
            />
          </TabsContent>
          <TabsContent value="access" className="m-0 h-full data-[state=inactive]:hidden">
            <GitAccessPanel
              access={access.access}
              loading={access.loading}
              error={access.error}
              pendingAction={pendingAction}
              platform={environment?.platform}
              userEmail={environment?.userEmail}
              onRefresh={() => access.refresh(pendingActionHosts(pendingAction)).then(() => undefined)}
              onConfigureCredentialHelper={(input) => access.configureCredentialHelper(input, { hosts: pendingActionHosts(pendingAction) })}
              onSaveHttpsCredential={(input) => access.saveHttpsCredential(input, { hosts: pendingActionHosts(pendingAction) })}
              onClearHttpsCredential={(input) => access.clearHttpsCredential(input, { hosts: pendingActionHosts(pendingAction) })}
              onGenerateSshKey={(input) => access.generateSshKey(input, { hosts: pendingActionHosts(pendingAction) })}
              onTestSshConnection={access.testSshConnection}
              retrying={retryPendingBusy}
              onRetryPendingAction={retryPendingAction}
            />
          </TabsContent>
        </Tabs>
      </SystemAppWindowShell>
      <GitCloneDialog
        open={cloneOpen}
        busy={operations.busy.global === "clone"}
        phase={operations.busy.globalPhase ?? null}
        environment={environment}
        onOpenChange={setCloneOpen}
        onSubmit={async (input) => {
          const result = await operations.cloneRepository(input)
          if (result.ok) {
            setCloneOpen(false)
            return null
          }
          return { error: result.error, failure: result.failure }
        }}
        onFailureAction={handleCloneFailure}
        onCancel={() => void operations.cancelGlobal()}
      />
      <GitAddLocalDialog
        open={addLocalOpen}
        busy={operations.busy.global === "add-local"}
        onOpenChange={setAddLocalOpen}
        onSubmit={async (input) => {
          const result = await operations.addLocalRepository(input)
          if (result.ok) {
            setAddLocalOpen(false)
            return null
          }
          return result.error
        }}
      />
      {pushRemoteSelection.dialog}
      {initialization.dialog}
    </>
  )
}
