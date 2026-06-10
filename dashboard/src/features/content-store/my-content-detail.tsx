import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { canInstallContent } from './content-store-actions'
import { ContentStoreDetailView } from './content-store-detail'

type MyContentDetailPageProps = {
  contentId: string
}

export default function MyContentDetailPage({
  contentId,
}: MyContentDetailPageProps) {
  const navigate = useNavigate()
  const detailQuery = useQuery({
    queryKey: ['my-content-store-detail', contentId],
    queryFn: () => dashboardApi.getContentStoreDetail(contentId),
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

  if (detailQuery.isLoading) {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>我的内容</h1>
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
          <h1 className='text-lg font-semibold'>我的内容</h1>
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
        <h1 className='text-lg font-semibold'>我的内容</h1>
      </Header>
      <Main className='flex flex-col gap-4'>
        <ContentStoreDetailView
          detail={detail}
          mode='mine'
          isInstalling={installMutation.isPending}
          onInstall={
            canInstallContent(detail, detail.owner.id)
              ? () => installMutation.mutate(detail.id)
              : undefined
          }
        />
      </Main>
    </>
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
