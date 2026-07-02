import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Download, GitFork, Search } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SkillRepositoryItemDto } from '@synapse/shared'
import { usePublicSkillRepositoryList } from './use-skill-repository'
import { useSkillRepositoryActions } from './use-skill-repository-actions'
import { getSkillRepositoryDisplayOwner } from './skill-repository-view-model'

export function SkillRepositoryExplorePage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const listQuery = usePublicSkillRepositoryList({ page: 1, pageSize: 20, query: query.trim() || null })
  const repositories = listQuery.data?.items ?? []

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-6'>
      <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <h1 className='text-xl font-semibold'>探索 Skills</h1>
        <div className='relative w-full md:w-72'>
          <Search className='pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='pl-8'
            placeholder='搜索 Skill'
          />
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto rounded-md border bg-background'>
        {listQuery.isLoading ? (
          <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>加载中</div>
        ) : listQuery.isError ? (
          <div className='flex h-full min-h-72 flex-col items-center justify-center gap-3 text-sm text-destructive'>
            <div>{listQuery.error instanceof Error ? listQuery.error.message : '加载失败。'}</div>
            <Button type='button' variant='outline' size='sm' onClick={() => { void listQuery.refetch() }}>重试</Button>
          </div>
        ) : repositories.length === 0 ? (
          <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>暂无公开 Skill</div>
        ) : (
          <Table className='min-w-max'>
            <TableHeader>
              <TableRow>
                <TableHead>仓库</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className='w-28'>可见性</TableHead>
                <TableHead className='w-40'>更新时间</TableHead>
                <TableHead className='w-36 text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repositories.map((repository) => (
                <TableRow
                  key={repository.id}
                  role='link'
                  tabIndex={0}
                  aria-label={`打开 ${repository.name}`}
                  className='cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
                  onClick={() => {
                    void navigate({
                      to: '/skills/$ownerHandle/$repositoryName',
                      params: {
                        ownerHandle: repository.owner.handle ?? getSkillRepositoryDisplayOwner({ ...repository, files: [] }),
                        repositoryName: repository.name,
                      },
                    })
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    void navigate({
                      to: '/skills/$ownerHandle/$repositoryName',
                      params: {
                        ownerHandle: repository.owner.handle ?? getSkillRepositoryDisplayOwner({ ...repository, files: [] }),
                        repositoryName: repository.name,
                      },
                    })
                  }}
                >
                  <TableCell className='font-medium'>
                    <RepositoryLink repository={repository} />
                  </TableCell>
                  <TableCell className='text-muted-foreground'>{repository.title}</TableCell>
                  <TableCell>
                    <Badge variant='secondary'>{formatVisibility(repository.visibility)}</Badge>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    <RelativeTime value={repository.updatedAt} />
                  </TableCell>
                  <TableCell
                    className='text-right'
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <RepositoryActions repository={repository} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function RepositoryLink({ repository }: { readonly repository: SkillRepositoryItemDto }) {
  const owner = getSkillRepositoryDisplayOwner({ ...repository, files: [] })
  return (
    <span>
      <span className='text-muted-foreground'>{owner}</span>
      <span className='px-1 text-muted-foreground'>/</span>
      <span>{repository.name}</span>
    </span>
  )
}

function RepositoryActions({ repository }: { readonly repository: SkillRepositoryItemDto }) {
  const actions = useSkillRepositoryActions(repository.id)
  return (
    <div className='flex justify-end gap-2'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label='安装'
        disabled={actions.states.installing}
        onClick={() => { void actions.createInstallSession() }}
      >
        <Download className='size-4' />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label='Fork'
        disabled={actions.states.forking}
        onClick={() => { void actions.forkRepository({}) }}
      >
        <GitFork className='size-4' />
      </Button>
    </div>
  )
}

function formatVisibility(value: 'private' | 'public'): string {
  return value === 'public' ? '公开' : '私有'
}
