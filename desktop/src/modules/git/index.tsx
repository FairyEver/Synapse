import { useCallback, useEffect, useState } from "react"
import { FolderGit2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { SynapseGitEnvironmentState, SynapseGitRepository } from "@/types/git"
import { GitAddLocalDialog, GitCloneDialog } from "./components/git-clone-dialog"
import { GitEnvironmentPanel } from "./components/git-environment-panel"
import { GitRepositoryList } from "./components/git-repository-list"
import { GitWorkbench } from "./components/git-workbench"
import { useGitOperations } from "./hooks/use-git-operations"
import { useGitRepositories } from "./hooks/use-git-repositories"

type GitAppViewId = "repositories" | "environment"

const GIT_APP_TABS: readonly { readonly id: GitAppViewId; readonly label: string }[] = [
  { id: "repositories", label: "仓库" },
  { id: "environment", label: "环境" },
]

export function GitModule() {
  const [view, setView] = useState<GitAppViewId>("repositories")
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
        tabs={GIT_APP_TABS}
        value={view}
        onValueChange={setView}
        actions={view === "repositories" && !selectedRepository ? (
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
        <Tabs value={view} className="contents">
          <TabsContent value="repositories" className="m-0 h-full data-[state=inactive]:hidden">
            {selectedRepository ? (
              <GitWorkbench
                repository={selectedRepository}
                onBack={() => setSelectedRepository(null)}
              />
            ) : (
              <GitRepositoryList
                summaries={repositoriesState.summaries}
                loading={repositoriesState.loading}
                error={repositoriesState.error ?? operations.error}
                busy={operations.busy}
                onOpenRepository={setSelectedRepository}
                onPull={(repositoryId) => void operations.pull(repositoryId)}
                onPush={(repositoryId) => void operations.push(repositoryId)}
                onSync={(repositoryId) => void operations.sync(repositoryId)}
                onRemoveRepository={(input) => operations.removeRepository(input)}
              />
            )}
          </TabsContent>
          <TabsContent value="environment" className="m-0 h-full data-[state=inactive]:hidden">
            <div className="h-full bg-surface">
              <GitEnvironmentPanel
                environment={environment}
                repositorySummaries={repositoriesState.summaries}
                loading={environmentLoading}
                error={environmentError}
                onRefresh={refreshEnvironment}
              />
            </div>
          </TabsContent>
        </Tabs>
      </SystemAppWindowShell>
      <GitCloneDialog
        open={cloneOpen}
        busy={operations.busy.global === "clone"}
        environment={environment}
        onOpenChange={setCloneOpen}
        onSubmit={async (input) => {
          const result = await operations.cloneRepository(input)
          if (result.ok) {
            setCloneOpen(false)
            return null
          }
          return result.error
        }}
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
    </>
  )
}
