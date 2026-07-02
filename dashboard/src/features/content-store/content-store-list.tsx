import { Link } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'

type ContentStoreListPageProps = {
  search?: Record<string, unknown>
}

export default function ContentStoreListPage(_props: ContentStoreListPageProps) {
  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Skill 仓库</h1>
      </Header>
      <Main>
        <ContentStoreRetiredPage />
      </Main>
    </>
  )
}

function ContentStoreRetiredPage() {
  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 py-8'>
      <div className='flex flex-col gap-1'>
        <h1 className='text-xl font-semibold tracking-tight'>Skill 仓库</h1>
        <p className='text-sm text-muted-foreground'>
          云端 Skill 已迁移到 Skill 仓库。
        </p>
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button asChild>
          <Link to='/skill-repositories/explore'>探索 Skills</Link>
        </Button>
        <Button variant='outline' asChild>
          <Link to='/skill-repositories'>我的 Skills</Link>
        </Button>
      </div>
    </div>
  )
}
