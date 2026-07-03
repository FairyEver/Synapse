import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Download, RefreshCw, Settings } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { skillRepositoryApi } from './skill-repository-api'
import { SkillRepositoryFileBrowser } from './skill-repository-file-browser'
import { SkillRepositorySettingsDialog } from './skill-repository-settings-dialog'
import { getSkillRepositoryDisplayOwner } from './skill-repository-view-model'
import { useSkillRepository } from './use-skill-repository'
import { useSkillRepositoryActions } from './use-skill-repository-actions'

export function SkillRepositoryDetailPage({ repositoryId }: { readonly repositoryId: string }) {
  const navigate = useNavigate()
  const repository = useSkillRepository(repositoryId)
  const actions = useSkillRepositoryActions(repositoryId)
  const detail = repository.detailQuery.data
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  if (repository.detailQuery.isLoading) {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>Skill 仓库</h1>
        </Header>
        <Main fixed fluid>
          <div className='flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground'>加载中</div>
        </Main>
      </>
    )
  }

  if (repository.detailQuery.isError || !detail || !repository.browser) {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>Skill 仓库</h1>
        </Header>
        <Main fixed fluid>
          <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-destructive'>
            <div>{repository.detailQuery.error instanceof Error ? repository.detailQuery.error.message : '加载失败。'}</div>
            <Button type='button' variant='outline' size='sm' onClick={() => { void repository.detailQuery.refetch() }}>重试</Button>
          </div>
        </Main>
      </>
    )
  }

  const owner = getSkillRepositoryDisplayOwner(detail)

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Skill 仓库</h1>
      </Header>
      <Main fixed fluid className='flex flex-1 flex-col gap-4'>
        <div className='mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3'>
          <div className='flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between'>
            <div className='flex min-w-0 items-center gap-2'>
              <h2 className='min-w-0 truncate text-base font-semibold'>
                <span className='text-muted-foreground'>{owner}</span>
                <span className='px-1 text-muted-foreground'>/</span>
                <span>{detail.name}</span>
              </h2>
              <Badge variant='secondary'>{formatVisibility(detail.visibility)}</Badge>
            </div>
            <div className='flex shrink-0 flex-wrap items-center justify-end gap-2'>
              <Button type='button' variant='outline' size='sm' onClick={() => { void repository.detailQuery.refetch() }}>
                <RefreshCw data-icon='inline-start' className={repository.detailQuery.isFetching ? 'animate-spin' : undefined} />
                刷新
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={actions.states.installing}
                onClick={() => { void actions.createInstallSession() }}
              >
                <Download data-icon='inline-start' />
                安装
              </Button>
              <Button type='button' variant='outline' size='sm' onClick={() => setSettingsOpen(true)}>
                <Settings data-icon='inline-start' />
                设置
              </Button>
            </div>
          </div>

          <SkillRepositoryFileBrowser
            tree={repository.browser.tree}
            selectedFilePath={repository.selectedFilePath}
            fileContent={repository.fileContentQuery.data ?? null}
            fileLoading={repository.fileContentQuery.isFetching}
            savingText={repository.states.savingText}
            reloadingFile={repository.states.reloadingFile}
            onNavigateFolder={(path) => {
              repository.setSelectedFilePath(null)
              repository.setCurrentPath(path)
            }}
            onOpenFile={repository.setSelectedFilePath}
            onRenameFile={repository.renameFile}
            onDeleteFile={repository.deleteFile}
            onDownloadFile={(path) => skillRepositoryApi.getFileDownloadUrl(repositoryId, path)}
            onReloadText={repository.reloadSelectedFile}
            onSaveText={repository.saveSelectedText}
          />
        </div>

        <SkillRepositorySettingsDialog
          repository={detail}
          open={settingsOpen}
          saving={repository.states.updating}
          deleting={repository.states.deletingRepository}
          error={settingsError}
          onOpenChange={(open) => {
            setSettingsOpen(open)
            if (!open) setSettingsError(null)
          }}
          onSave={async (input) => {
            setSettingsError(null)
            try {
              await repository.updateRepository(input)
              setSettingsOpen(false)
            } catch (error) {
              setSettingsError(error instanceof Error ? error.message : '保存失败。')
            }
          }}
          onDelete={async () => {
            setSettingsError(null)
            try {
              await repository.deleteRepository()
              await navigate({ to: '/skill-repositories' })
            } catch (error) {
              setSettingsError(error instanceof Error ? error.message : '删除失败。')
            }
          }}
        />
      </Main>
    </>
  )
}

function formatVisibility(value: 'private' | 'public'): string {
  return value === 'public' ? '公开' : '私有'
}
