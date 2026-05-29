import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

export default function SettingsPage() {
  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>设置</h1>
      </Header>
      <Main>
        <div className='text-muted-foreground'>暂无可配置项</div>
      </Main>
    </>
  )
}
