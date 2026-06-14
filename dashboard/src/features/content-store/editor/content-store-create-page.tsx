import { useRef, useState } from 'react'
import type { ContentStoreDraftDto, ContentStoreType } from '@synapse/shared'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

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
  const navigate = useNavigate()
  const [type, setType] = useState<ContentStoreType>('skill')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const creatingRef = useRef(false)

  async function handleCreate() {
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    try {
      const draft = await createContentStoreDraftFromForm({ type, title, description, body })
      void navigate({
        to: '/my-content/$contentId/edit',
        params: { contentId: draft.itemId },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败')
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>新建内容</h1>
      </Header>
      <Main className='flex flex-col gap-4'>
        <div className='grid gap-4 max-w-3xl'>
          <div className='grid gap-2'>
            <Label htmlFor='content-type'>类型</Label>
            <Select value={type} onValueChange={(value) => setType(value as ContentStoreType)}>
              <SelectTrigger id='content-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value='skill'>Skill</SelectItem>
                  <SelectItem value='rule'>Rule</SelectItem>
                  <SelectItem value='prompt'>Prompt</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='content-title'>标题</Label>
            <Input id='content-title' value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='content-description'>描述</Label>
            <Textarea id='content-description' value={description} onChange={(event) => setDescription(event.target.value)} className='min-h-24 resize-y' />
          </div>
          {type !== 'skill' ? (
            <div className='grid gap-2'>
              <Label htmlFor='content-body'>正文</Label>
              <Textarea id='content-body' value={body} onChange={(event) => setBody(event.target.value)} className='min-h-120 resize-y font-mono text-sm' />
            </div>
          ) : (
            <div className='rounded-md border p-4 text-sm text-muted-foreground'>
              将创建 SKILL.md
            </div>
          )}
          <div className='flex justify-end'>
            <Button disabled={isCreating} onClick={() => void handleCreate()}>
              <Plus data-icon='inline-start' />
              创建草稿
            </Button>
          </div>
        </div>
      </Main>
    </>
  )
}
