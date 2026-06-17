import { useEffect, useState } from "react"
import { FolderGit2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import type { SynapseGitEnvironmentState, SynapseGitRepository } from "@/types/git"
import { GitAddLocalDialog, GitCloneDialog } from "./components/git-clone-dialog"
import { GitRepositoryList } from "./components/git-repository-list"
import { GitWorkbench } from "./components/git-workbench"
import { useGitOperations } from "./hooks/use-git-operations"
import { useGitRepositories } from "./hooks/use-git-repositories"

function environmentMessage(environment: SynapseGitEnvironmentState | null): string | null {
  if (!environment) return null
  if (!environment.gitAvailable) return environment.installHint ?? "未检测到 Git。"
  if (!environment.userName || !environment.userEmail) return "请先配置 Git 用户名和邮箱。"
  if (!environment.sshAvailable) return "未检测到 SSH。HTTPS 仓库不受影响。"
  return null
}

export function GitModule() {
  const [selectedRepository, setSelectedRepository] = useState<SynapseGitRepository | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [addLocalOpen, setAddLocalOpen] = useState(false)
  const [environment, setEnvironment] = useState<SynapseGitEnvironmentState | null>(null)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const repositoriesState = useGitRepositories()
  const operations = useGitOperations(repositoriesState.refresh)

  useEffect(() => {
    let cancelled = false
    async function check() {
      setEnvironmentError(null)
      try {
        const state = await getSynapseBridge()?.git.checkEnvironment()
        if (!cancelled) setEnvironment(state ?? null)
      } catch (err) {
        if (!cancelled) setEnvironmentError(err instanceof Error ? err.message : "Git 环境检测失败。")
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

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
          <GitRepositoryList
            repositories={repositoriesState.repositories}
            loading={repositoriesState.loading}
            error={repositoriesState.error ?? operations.error ?? environmentError}
            environmentMessage={environmentMessage(environment)}
            busy={operations.busy}
            onOpenRepository={setSelectedRepository}
            onPull={(repositoryId) => void operations.pull(repositoryId)}
            onPush={(repositoryId) => void operations.push(repositoryId)}
            onSync={(repositoryId) => void operations.sync(repositoryId)}
            onRemoveRepository={(input) => operations.removeRepository(input)}
          />
        )}
      </SystemAppWindowShell>
      <GitCloneDialog
        open={cloneOpen}
        busy={operations.busy.global === "clone"}
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
