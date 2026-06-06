import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Trash2, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { downloadBackupWithFeedback } from './backup-download'
import { getBackupListErrorMessage } from './backup-error'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function BackupPage() {
  const queryClient = useQueryClient()

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-backups'],
    queryFn: adminApi.listBackups,
  })

  const triggerBackup = useMutation({
    mutationFn: adminApi.triggerBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] })
      toast.success('备份已创建')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteBackup = useMutation({
    mutationFn: adminApi.deleteBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] })
      toast.success('备份已删除')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>备份管理</h1>
      </Header>
      <Main>
        <div className='pb-4'>
          <Button onClick={() => triggerBackup.mutate()} disabled={triggerBackup.isPending}>
            {triggerBackup.isPending ? <Loader2 className='mr-1 h-4 w-4 animate-spin' /> : <Plus className='mr-1 h-4 w-4' />}
            创建备份
          </Button>
        </div>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : isError ? (
          <Alert variant='destructive'>
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>
              <p>{getBackupListErrorMessage(error)}</p>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => void refetch()}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead>大小</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((backup) => (
                  <TableRow key={backup.filename}>
                    <TableCell className='font-medium'>{backup.filename}</TableCell>
                    <TableCell>{formatSize(backup.size)}</TableCell>
                    <TableCell>
                      {new Date(backup.createdAt).toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell className='flex gap-1'>
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={`下载 ${backup.filename}`}
                        onClick={() => void downloadBackupWithFeedback(backup.filename)}
                      >
                        <Download className='h-4 w-4' />
                      </Button>
                      <Button variant='ghost' size='icon' onClick={() => deleteBackup.mutate(backup.filename)}>
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className='text-center text-muted-foreground'>暂无备份</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>
    </>
  )
}
