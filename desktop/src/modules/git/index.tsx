import { useCallback, useEffect, useState } from "react"
import { FolderGit2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { SynapseGitEnvironmentState, SynapseGitRepository } from "@/types/git"
import { GitAddLocalDialog, GitCloneDialog } from "./components/git-clone-dialog"
import { GitEnvironmentPanel } from "./components/git-environment-panel"
import { GitRepositoryList } from "./components/git-repository-list"
import { GitWorkbench } from "./components/git-workbench"
import { useGitOperations } from "./hooks/use-git-operations"
import { useGitRepositories } from "./hooks/use-git-repositories"

export function GitModule() {
  const [selectedRepository, setSelectedRepository] = useState<SynapseGitRepository | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [addLocalOpen, setAddLocalOpen] = useState(false)
  const [environment, setEnvironment] = useState<SynapseGitEnvironmentState | null>(null)
  const [environmentLoading, setEnvironmentLoading] = useState(false)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const repositoriesState = useGitRepositories()
  const operations = useGitOperations(repositoriesState.refresh)

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

  return (
    <>
      <SystemAppWindowShell
        actions={!selectedRepository ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddLocalOpen(true)}
              disabled={operations.busy.global !== null}
            >
              <FolderGit2 data-icon="inline-start" />
              添加本地仓库
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setCloneOpen(true)}
              disabled={operations.busy.global !== null}
            >
              <Plus data-icon="inline-start" />
              克隆仓库
            </Button>
          </>
        ) : undefined}
      >
        {selectedRepository ? (
          <GitWorkbench
            repository={selectedRepository}
            onBack={() => setSelectedRepository(null)}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="shrink-0 p-4 pb-0">
              <GitEnvironmentPanel
                environment={environment}
                loading={environmentLoading}
                onRefresh={refreshEnvironment}
              />
            </div>
            <GitRepositoryList
              summaries={repositoriesState.summaries}
              loading={repositoriesState.loading}
              error={repositoriesState.error ?? operations.error ?? environmentError}
              busy={operations.busy}
              onOpenRepository={setSelectedRepository}
              onPull={(repositoryId) => void operations.pull(repositoryId)}
              onPush={(repositoryId) => void operations.push(repositoryId)}
              onSync={(repositoryId) => void operations.sync(repositoryId)}
              onRemoveRepository={(input) => operations.removeRepository(input)}
            />
          </div>
        )}
      </SystemAppWindowShell>
      <GitCloneDialog
        open={cloneOpen}
        busy={operations.busy.global === "clone"}
        environment={environment}
        onOpenChange={setCloneOpen}
        onSubmit={async (input) => {
          if (await operations.cloneRepository(input)) setCloneOpen(false)
        }}
      />
      <GitAddLocalDialog
        open={addLocalOpen}
        busy={operations.busy.global === "add-local"}
        onOpenChange={setAddLocalOpen}
        onSubmit={async (input) => {
          if (await operations.addLocalRepository(input)) setAddLocalOpen(false)
        }}
      />
    </>
  )
}
