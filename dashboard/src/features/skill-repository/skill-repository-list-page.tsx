import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus, RefreshCw } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSkillRepositoryList } from './use-skill-repository'

export function SkillRepositoryListPage() {
  const navigate = useNavigate()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const query = useSkillRepositoryList()
  const repositories = query.data ?? []

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-6'>
      <div className='flex items-center justify-between gap-3'>
        <h1 className='text-xl font-semibold'>我的 Skill 仓库</h1>
        <div className='flex items-center gap-2'>
          <Button type='button' size='sm' onClick={() => setCreateDialogOpen(true)}>
            <Plus data-icon='inline-start' />
            新建
          </Button>
          <Button type='button' variant='outline' size='sm' onClick={() => { void query.refetch() }}>
            <RefreshCw data-icon='inline-start' className={query.isFetching ? 'animate-spin' : undefined} />
            刷新
          </Button>
        </div>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>网页端暂未提供新建入口</DialogTitle>
            <DialogDescription>
              当前页面仅支持查看和管理已有 Skill 仓库。请在 Synapse 客户端从本地 Skill 上传或导入仓库，完成后刷新本页查看。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type='button'>关闭</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className='min-h-0 flex-1 overflow-auto rounded-md border bg-background'>
        {query.isLoading ? (
          <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>加载中</div>
        ) : query.isError ? (
          <div className='flex h-full min-h-72 flex-col items-center justify-center gap-3 text-sm text-destructive'>
            <div>{query.error instanceof Error ? query.error.message : '加载失败。'}</div>
            <Button type='button' variant='outline' size='sm' onClick={() => { void query.refetch() }}>重试</Button>
          </div>
        ) : repositories.length === 0 ? (
          <div className='flex h-full min-h-72 flex-col items-center justify-center gap-1 text-sm text-muted-foreground'>
            <div>暂无 Skill 仓库</div>
            <div>通过本地 Synapse MCP 上传 Skill 后会显示在这里。</div>
          </div>
        ) : (
          <Table className='min-w-max'>
            <TableHeader>
              <TableRow>
                <TableHead>仓库</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className='w-24 text-right'>文件</TableHead>
                <TableHead className='w-28'>可见性</TableHead>
                <TableHead className='w-40'>更新时间</TableHead>
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
                      to: '/skill-repositories/$repositoryId',
                      params: { repositoryId: repository.id },
                    })
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    void navigate({
                      to: '/skill-repositories/$repositoryId',
                      params: { repositoryId: repository.id },
                    })
                  }}
                >
                  <TableCell className='font-medium'>
                    {repository.name}
                  </TableCell>
                  <TableCell className='text-muted-foreground'>{repository.title}</TableCell>
                  <TableCell className='text-right text-muted-foreground'>-</TableCell>
                  <TableCell>
                    <Badge variant='secondary'>{formatVisibility(repository.visibility)}</Badge>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    <RelativeTime value={repository.updatedAt} />
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

function formatVisibility(value: 'private' | 'public'): string {
  return value === 'public' ? '公开' : '私有'
}
