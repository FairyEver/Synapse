import type { ContentStoreDraftDto, ContentStoreType } from '@synapse/shared'
import { Link } from '@tanstack/react-router'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'

type ContentStoreCreateForm = {
  type: ContentStoreType
  title: string
  description: string
  body: string
}

type CreateDraft = typeof dashboardApi.createContentStoreDraft

export async function createContentStoreDraftFromForm(
  form: ContentStoreCreateForm,
  createDraft: CreateDraft = dashboardApi.createContentStoreDraft
): Promise<ContentStoreDraftDto> {
  const trimmedTitle = form.title.trim()
  const trimmedBody = form.body.trim()
  if (!trimmedTitle) throw new Error('标题不能为空')
  if (form.type !== 'skill' && !trimmedBody) throw new Error('正文不能为空')
  if (form.type === 'skill') {
    return createDraft({
      type: form.type,
      title: trimmedTitle,
      description: form.description.trim() || null,
      files: [
        {
          path: 'SKILL.md',
          contentBase64: 'IyBTa2lsbA==',
          mimeType: 'text/markdown',
        },
      ],
    })
  }
  return createDraft({
    type: form.type,
    title: trimmedTitle,
    description: form.description.trim() || null,
    body: trimmedBody,
  })
}

export function ContentStoreCreatePage() {
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
