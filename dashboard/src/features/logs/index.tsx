import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { getCleanupBeforeDate } from './cleanup-date'
import { getCleanupResultMessage } from './cleanup-result'
import { getLogsQueryErrorMessage } from './logs-error'

const allLogLevelsValue = 'all'
export const logLevelOptions = [
  { value: allLogLevelsValue, label: '全部' },
  { value: 'fatal', label: 'fatal' },
  { value: 'error', label: 'error' },
  { value: 'warn', label: 'warn' },
  { value: 'info', label: 'info' },
  { value: 'debug', label: 'debug' },
] as const

export default function LogsPage() {
  const [level, setLevel] = useState(allLogLevelsValue)
  const [limit, setLimit] = useState(100)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [isCleaning, setIsCleaning] = useState(false)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-logs-recent', level, limit],
    queryFn: () =>
      adminApi.fetchRecentLogs({
        level: level === allLogLevelsValue ? undefined : level,
        limit,
      }),
  })

  async function handleDownload() {
    try {
      await adminApi.downloadLogs({})
      toast.success('日志下载中')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '下载失败')
    }
  }

  async function handleCleanup() {
    const before = getCleanupBeforeDate()
    setIsCleaning(true)
    try {
      const result = await adminApi.cleanupLogs(before)
      setCleanupOpen(false)
      toast.success(getCleanupResultMessage(result))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '清理失败')
    } finally {
      setIsCleaning(false)
    }
  }

  function levelColor(lvl: string) {
    switch (lvl) {
      case 'fatal':
      case 'error': return 'destructive' as const
      case 'warn': return 'secondary' as const
      default: return 'outline' as const
    }
  }

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>系统日志</h1>
      </Header>
      <Main>
        <div className='flex items-center gap-2 pb-4'>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className='w-32'>
              <SelectValue placeholder='级别' />
            </SelectTrigger>
            <SelectContent>
              {logLevelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type='number'
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 100)}
            className='w-24'
            placeholder='条数'
          />
          <Button variant='outline' size='sm' onClick={handleDownload}>
            <Download className='mr-1 h-4 w-4' />
            下载
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={isCleaning}
            onClick={() => setCleanupOpen(true)}
          >
            <Trash2 className='mr-1 h-4 w-4' />
            清理7天前
          </Button>
        </div>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : isError ? (
          <Alert variant='destructive'>
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>
              <p>{getLogsQueryErrorMessage(error)}</p>
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
          <div className='space-y-1 rounded-md border p-3 font-mono text-xs'>
            {data?.map((entry, i) => (
              <div key={i} className='flex gap-2'>
                <span className='shrink-0 text-muted-foreground'>
                  {new Date(entry.time).toLocaleTimeString('zh-CN')}
                </span>
                <Badge variant={levelColor(entry.level)} className='shrink-0 text-[10px]'>
                  {entry.level}
                </Badge>
                <span className='break-all'>{entry.msg}</span>
              </div>
            ))}
            {data?.length === 0 && (
              <div className='text-muted-foreground'>暂无日志</div>
            )}
          </div>
        )}
        <ConfirmDialog
          open={cleanupOpen}
          onOpenChange={setCleanupOpen}
          title='清理日志'
          desc='将删除 7 天前的系统日志。'
          cancelBtnText='取消'
          confirmText='清理'
          destructive
          isLoading={isCleaning}
          handleConfirm={() => void handleCleanup()}
        />
      </Main>
    </>
  )
}
