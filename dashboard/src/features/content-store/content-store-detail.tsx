import { useEffect, useMemo, useState } from 'react'
import type { ContentStoreDetailDto, ContentStoreFileDto } from '@synapse/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  canCopyContent,
  canCopyPromptText,
  canInstallContent,
} from './content-store-actions'
import {
  formatContentStoreSize,
  getContentStoreOwnerName,
  getContentStoreTypeLabel,
} from './content-store-display'

type ContentStoreDetailPageProps = {
  contentId: string
}

type ContentStoreDetailViewProps = {
  detail: ContentStoreDetailDto
  mode?: 'store' | 'mine' | 'admin'
  onInstall?: () => void
  onCopyToMine?: () => void
  onCopyPromptText?: () => void
  isInstalling?: boolean
  isCopying?: boolean
}

export default function ContentStoreDetailPage({
  contentId,
}: ContentStoreDetailPageProps) {
  const navigate = useNavigate()
  const legacyRouteQuery = useQuery({
    queryKey: ['legacy-content-store-route', contentId],
    queryFn: () => dashboardApi.resolveLegacyContentStoreRoute(contentId),
  })
  const detailQuery = useQuery({
    queryKey: ['content-store-detail', contentId],
    queryFn: () => dashboardApi.getContentStoreDetail(contentId),
    enabled: legacyRouteQuery.data?.status === 'not_found' || legacyRouteQuery.isError,
  })

  const installMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.createContentStoreInstallSession(id),
    onSuccess: (session) => {
      window.location.href = session.deepLinkUrl
      window.setTimeout(() => {
        void navigate({
          to: '/content-store/install',
          search: { session: session.id },
        })
      }, 250)
    },
    onError: (error) => toast.error(getErrorMessage(error, '安装失败')),
  })

  const copyMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.copyContentStoreItem(id),
    onSuccess: (item) => {
      toast.success('已复制')
      void navigate({
        to: '/my-content/$contentId',
        params: { contentId: item.id },
      })
    },
    onError: (error) => toast.error(getErrorMessage(error, '复制失败')),
  })

  useEffect(() => {
    if (legacyRouteQuery.data?.status !== 'migrated') return
    void navigate({
      to: '/skill-repositories/$repositoryId',
      params: { repositoryId: legacyRouteQuery.data.repositoryId },
      replace: true,
    })
  }, [legacyRouteQuery.data, navigate])

  if (legacyRouteQuery.data?.status === 'retired') {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>内容已停止维护</h1>
        </Header>
        <Main>
          <div className='mx-auto flex w-full max-w-2xl flex-col gap-3 py-8'>
            <h1 className='text-xl font-semibold tracking-tight'>内容已停止维护</h1>
            <p className='text-sm text-muted-foreground'>{legacyRouteQuery.data.message}</p>
            <Button variant='outline' className='w-fit' asChild>
              <Link to='/skill-repositories/explore'>探索 Skills</Link>
            </Button>
          </div>
        </Main>
      </>
    )
  }

  if (legacyRouteQuery.isLoading || legacyRouteQuery.data?.status === 'migrated' || detailQuery.isLoading) {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>内容商店</h1>
        </Header>
        <Main>
          <div className='text-muted-foreground'>加载中...</div>
        </Main>
      </>
    )
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>内容商店</h1>
        </Header>
        <Main>
          <div className='flex flex-col gap-3'>
            <div className='font-medium'>内容不可用</div>
            <Button
              variant='outline'
              className='w-fit'
              onClick={() => void detailQuery.refetch()}
            >
              重试
            </Button>
          </div>
        </Main>
      </>
    )
  }

  const detail = detailQuery.data

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>内容商店</h1>
      </Header>
      <Main className='flex flex-col gap-4'>
        <ContentStoreDetailView
          detail={detail}
          mode='store'
          isInstalling={installMutation.isPending}
          isCopying={copyMutation.isPending}
          onInstall={
            canInstallContent(detail)
              ? () => installMutation.mutate(detail.id)
              : undefined
          }
          onCopyToMine={
            canCopyContent(detail) ? () => copyMutation.mutate(detail.id) : undefined
          }
          onCopyPromptText={
            canCopyPromptText(detail)
              ? () => void copyPromptBody(detail.body)
              : undefined
          }
        />
      </Main>
    </>
  )
}

export function ContentStoreDetailView({
  detail,
  mode = 'store',
  onInstall,
  onCopyToMine,
  onCopyPromptText,
  isInstalling,
  isCopying,
}: ContentStoreDetailViewProps) {
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-2xl font-semibold'>{detail.title}</h2>
            <Badge variant='secondary'>{getContentStoreTypeLabel(detail.type)}</Badge>
            <Badge variant={detail.visibility === 'public' ? 'default' : 'outline'}>
              {detail.visibility === 'public' ? '公开' : '私有'}
            </Badge>
            {detail.moderationStatus === 'removed' ? (
              <Badge variant='destructive'>已下架</Badge>
            ) : null}
          </div>
          <div className='flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground'>
            <span>{getContentStoreOwnerName(detail.owner)}</span>
            <span>安装 {detail.installCount}</span>
            <span>更新 <RelativeTime value={detail.updatedAt} /></span>
            {detail.latestVersionNumber ? (
              <span>v{detail.latestVersionNumber}</span>
            ) : null}
          </div>
        </div>
        {mode !== 'admin' ? (
          <div className='flex flex-wrap gap-2'>
            {onInstall ? (
              <Button onClick={onInstall} disabled={isInstalling}>
                安装
              </Button>
            ) : null}
            {onCopyPromptText ? (
              <Button variant='outline' onClick={onCopyPromptText}>
                复制文本
              </Button>
            ) : null}
            {onCopyToMine ? (
              <Button
                variant={onInstall ? 'outline' : 'default'}
                onClick={onCopyToMine}
                disabled={isCopying}
              >
                复制到我的内容
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {detail.description ? (
        <p className='max-w-3xl text-sm text-muted-foreground'>
          {detail.description}
        </p>
      ) : null}

      {detail.type === 'skill' ? (
        <ContentStoreFileViewer files={detail.files} />
      ) : (
        <ContentStoreBodyViewer value={detail.body ?? ''} />
      )}
    </div>
  )
}

function ContentStoreFileViewer({ files }: { files: ContentStoreFileDto[] }) {
  const sortedFiles = useMemo(
    () => [...files].sort((left, right) => left.path.localeCompare(right.path)),
    [files]
  )
  const [selectedPath, setSelectedPath] = useState(
    sortedFiles.find((file) => file.kind === 'text')?.path ?? sortedFiles[0]?.path
  )
  const selectedFile =
    sortedFiles.find((file) => file.path === selectedPath) ?? sortedFiles[0]

  if (!selectedFile) {
    return <div className='text-muted-foreground'>暂无文件</div>
  }

  return (
    <div className='grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]'>
      <div className='overflow-hidden rounded-md border'>
        <div className='border-b px-3 py-2 text-sm font-medium'>文件</div>
        <div className='max-h-100 overflow-auto'>
          {sortedFiles.map((file) => (
            <button
              key={file.path}
              type='button'
              className='flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground'
              data-active={file.path === selectedFile.path}
              onClick={() => setSelectedPath(file.path)}
            >
              <span className='min-w-0 truncate'>{file.path}</span>
              {file.kind === 'binary' ? (
                <span className='shrink-0 text-muted-foreground'>
                  {formatContentStoreSize(file.size)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className='min-h-80 overflow-hidden rounded-md border'>
        <div className='flex items-center justify-between gap-3 border-b px-3 py-2 text-sm'>
          <span className='min-w-0 truncate font-medium'>{selectedFile.path}</span>
          <span className='shrink-0 text-muted-foreground'>
            {formatContentStoreSize(selectedFile.size)}
          </span>
        </div>
        {selectedFile.kind === 'text' ? (
          <pre className='max-h-150 overflow-auto p-4 text-sm whitespace-pre-wrap'>
            {selectedFile.text ?? ''}
          </pre>
        ) : (
          <div className='p-4 text-sm text-muted-foreground'>二进制文件</div>
        )}
      </div>
    </div>
  )
}

function ContentStoreBodyViewer({ value }: { value: string }) {
  return (
    <Textarea
      readOnly
      value={value}
      className='min-h-80 resize-none font-mono text-sm'
    />
  )
}

async function copyPromptBody(value: string | null) {
  await navigator.clipboard.writeText(value ?? '')
  toast.success('已复制')
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
