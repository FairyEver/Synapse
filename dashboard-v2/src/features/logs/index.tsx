import { Alert, Button, Chip, Input, ListBox, Select, Table, toast } from '@heroui/react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Trash2 } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { getCleanupBeforeDate, LOG_CLEANUP_RETENTION_DAYS } from './cleanup-date'
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
      toast.danger(err instanceof Error ? err.message : '下载失败')
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
      toast.danger(err instanceof Error ? err.message : '清理失败')
    } finally {
      setIsCleaning(false)
    }
  }

  function levelColor(lvl: string) {
    switch (lvl) {
      case 'fatal':
      case 'error': return 'danger' as const
      case 'warn': return 'warning' as const
      default: return 'default' as const
    }
  }

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>系统日志</h1>
      </Header>
      <Main>
        <div className='flex flex-wrap items-center gap-2'>
          <Select aria-label="筛选选项" value={level} onChange={(key) => (setLevel)(String(key ?? ''))}>
            <Select.Trigger className='w-32'>
              <Select.Value  />
            <Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox>
              {logLevelOptions.map((option) => (
                <ListBox.Item key={option.value} id={option.value}>{option.label}<ListBox.ItemIndicator /></ListBox.Item>
              ))}
            </ListBox></Select.Popover>
          </Select>
          <Input
            aria-label='日志条数'
            type='number'
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 100)}
            className='w-24'
            placeholder='条数'
          />
          <Button variant='outline' size='sm' onPress={handleDownload}>
            <Download className='mr-1 h-4 w-4' />
            下载
          </Button>
          <Button
            variant='outline'
            size='sm'
            isDisabled={isCleaning}
            onPress={() => setCleanupOpen(true)}
          >
            <Trash2 className='mr-1 h-4 w-4' />
            清理{LOG_CLEANUP_RETENTION_DAYS}天前
          </Button>
        </div>
        {isLoading ? (
          <div className='text-muted'>加载中...</div>
        ) : isError ? (
          <Alert status="danger">
            <Alert.Indicator /><Alert.Content><Alert.Title>加载失败</Alert.Title>
            <Alert.Description>
              <p>{getLogsQueryErrorMessage(error)}</p>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onPress={() => void refetch()}
              >
                重试
              </Button>
            </Alert.Description></Alert.Content>
          </Alert>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label='系统日志'>
                <Table.Header>
                  <Table.Column id='time' isRowHeader>时间</Table.Column>
                  <Table.Column id='level'>级别</Table.Column>
                  <Table.Column id='message'>内容</Table.Column>
                </Table.Header>
                <Table.Body renderEmptyState={() => '暂无日志'}>
                  {data?.map((entry, index) => <Table.Row id={String(index)} key={index}>
                    <Table.Cell className='whitespace-nowrap tabular-nums text-muted'>{new Date(entry.time).toLocaleTimeString('zh-CN')}</Table.Cell>
                    <Table.Cell><Chip color={levelColor(entry.level)} size='sm'>{entry.level}</Chip></Table.Cell>
                    <Table.Cell className='break-all font-mono text-xs'>{entry.msg}</Table.Cell>
                  </Table.Row>)}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
        <ConfirmDialog
          open={cleanupOpen}
          onOpenChange={setCleanupOpen}
          title='清理日志'
          desc={`将删除 ${LOG_CLEANUP_RETENTION_DAYS} 天前的系统日志。`}
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
