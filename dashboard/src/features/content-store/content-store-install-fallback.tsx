import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'

type ContentStoreInstallFallbackPageProps = {
  session?: string
}

export default function ContentStoreInstallFallbackPage({
  session,
}: ContentStoreInstallFallbackPageProps) {
  const deepLinkUrl = session
    ? `synapse://content-install?session=${encodeURIComponent(session)}`
    : null

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>打开 Synapse</h1>
      </Header>
      <Main className='flex flex-col gap-4'>
        {deepLinkUrl ? (
          <>
            <div className='font-medium'>正在打开 Synapse</div>
            <div className='flex flex-wrap gap-2'>
              <Button onClick={() => window.location.assign(deepLinkUrl)}>
                重新打开
              </Button>
              <Button
                variant='outline'
                onClick={() => void navigator.clipboard.writeText(deepLinkUrl)}
              >
                复制链接
              </Button>
            </div>
          </>
        ) : (
          <div className='font-medium'>安装链接无效</div>
        )}
      </Main>
    </>
  )
}
