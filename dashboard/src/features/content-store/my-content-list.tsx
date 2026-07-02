import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'

type MyContentListPageProps = {
  search?: Record<string, unknown>
}

export default function MyContentListPage(_props: MyContentListPageProps) {
  const migrate = useMutation({
    mutationFn: () => dashboardApi.migrateLegacyContentStoreSkills(),
  })

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>我的 Skills</h1>
      </Header>
      <Main>
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 py-8'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-xl font-semibold tracking-tight'>我的 Skills</h1>
            <p className='text-sm text-muted-foreground'>
              旧内容商店里的 Skill 可以迁移到 Skill 仓库。
            </p>
          </div>
          {migrate.data ? (
            <div className='rounded-lg border p-4 text-sm text-muted-foreground'>
              已扫描 {migrate.data.scanned} 项，迁移 {migrate.data.migrated} 项，已迁移 {migrate.data.alreadyMigrated} 项。
            </div>
          ) : null}
          {migrate.error ? (
            <p className='text-sm text-destructive'>{getErrorMessage(migrate.error)}</p>
          ) : null}
          <div className='flex flex-wrap gap-2'>
            <Button onClick={() => migrate.mutate()} disabled={migrate.isPending}>
              {migrate.isPending ? '迁移中' : '迁移旧 Skill'}
            </Button>
            <Button variant='outline' asChild>
              <Link to='/skill-repositories'>打开我的 Skills</Link>
            </Button>
          </div>
        </div>
      </Main>
    </>
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '操作失败。'
}
