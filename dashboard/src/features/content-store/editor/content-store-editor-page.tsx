import { Link } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'

type ContentStoreEditorPageProps = {
  contentId: string
}

export function ContentStoreEditorPage(_props: ContentStoreEditorPageProps) {
  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Skill 仓库</h1>
      </Header>
      <Main>
        <div className='mx-auto flex w-full max-w-2xl flex-col gap-3 py-8'>
          <h1 className='text-xl font-semibold tracking-tight'>Skill 仓库</h1>
          <p className='text-sm text-muted-foreground'>
            云端 Prompt 和 Rule 商店已停止维护。Skill 请通过本地上传到 Skill 仓库。
          </p>
          <Button className='w-fit' asChild>
            <Link to='/skill-repositories'>打开我的 Skills</Link>
          </Button>
        </div>
      </Main>
    </>
  )
}
