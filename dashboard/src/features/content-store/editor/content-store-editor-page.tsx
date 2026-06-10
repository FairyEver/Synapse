import { useEffect, useState } from 'react'
import type { ContentStoreType } from '@synapse/shared'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { getContentStoreTypeLabel } from '../content-store-display'
import { ContentStorePublishDialog } from './content-store-publish-dialog'
import { RulePromptEditor } from './rule-prompt-editor'
import { SkillFileEditor } from './skill-file-editor'
import { SkillFileTree } from './skill-file-tree'
import { useContentStoreDraftEditor } from './use-content-store-draft-editor'

type ContentStoreEditorPageProps = {
  contentId: string
}

export function ContentStoreEditorPage({ contentId }: ContentStoreEditorPageProps) {
  const navigate = useNavigate()
  const { detail, state, isLoading, error, actions, isSaving, isPublishing, isSettingVisibility } =
    useContentStoreDraftEditor({ contentId })
  const [publishOpen, setPublishOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedPath && state) {
      setSelectedPath(state.files[0]?.path ?? null)
    }
  }, [selectedPath, state?.files])

  if (error) {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>编辑内容</h1>
        </Header>
        <Main>
          <div className='flex flex-col gap-3'>
            <div className='font-medium'>内容不可用</div>
            <Button variant='outline' className='w-fit' onClick={() => window.location.reload()}>
              重试
            </Button>
          </div>
        </Main>
      </>
    )
  }

  if (isLoading || !state || !detail) {
    return (
      <>
        <Header fixed>
          <h1 className='text-lg font-semibold'>编辑内容</h1>
        </Header>
        <Main>
          <div className='text-sm text-muted-foreground'>加载中...</div>
        </Main>
      </>
    )
  }

  const isSkill = state.type === 'skill'

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-3'>
          <Button variant='ghost' size='icon' onClick={() => void navigate({ to: '/my-content/$contentId', params: { contentId } })}>
            <ArrowLeft data-icon='inline-start' />
          </Button>
          <h1 className='text-lg font-semibold'>编辑内容</h1>
        </div>
      </Header>
      <Main className='flex flex-col gap-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <span>{getContentStoreTypeLabel(state.type as ContentStoreType)}</span>
            <span>·</span>
            <span>{detail.visibility === 'public' ? '公开' : '私有'}</span>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='outline' onClick={() => void actions.saveDraft()} disabled={isSaving}>
              <Save data-icon='inline-start' />
              保存
            </Button>
            <Button onClick={() => setPublishOpen(true)} disabled={isPublishing}>
              发布
            </Button>
            <div className='flex items-center gap-2 rounded-md border px-3 py-2'>
              <span className='text-sm'>公开</span>
              <Switch
                checked={detail.visibility === 'public'}
                disabled={isSettingVisibility}
                onCheckedChange={(checked) => void actions.setVisibility(checked ? 'public' : 'private')}
              />
            </div>
          </div>
        </div>

        <div className='grid gap-4 max-w-3xl'>
          <div className='grid gap-2'>
            <Label htmlFor='content-title'>标题</Label>
            <Input id='content-title' value={state.title} onChange={(event) => actions.setTitle(event.target.value)} />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='content-description'>描述</Label>
            <Textarea id='content-description' value={state.description} onChange={(event) => actions.setDescription(event.target.value)} className='min-h-24 resize-y' />
          </div>
        </div>

        {isSkill ? (
          <div className='grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]'>
            <SkillFileTree
              files={state.files}
              selectedPath={selectedPath ?? state.files[0]?.path ?? null}
              onSelect={setSelectedPath}
              onFilesChange={(files) => {
                actions.setFiles(files)
                setSelectedPath(files.find((file) => file.path === selectedPath)?.path ?? files[0]?.path ?? null)
              }}
            />
            <SkillFileEditor
              files={state.files}
              selectedPath={selectedPath ?? state.files[0]?.path ?? null}
              onFilesChange={(files) => {
                actions.setFiles(files)
                setSelectedPath(files.find((file) => file.path === selectedPath)?.path ?? files[0]?.path ?? null)
              }}
            />
          </div>
        ) : (
          <RulePromptEditor
            id='content-body'
            label='正文'
            value={state.body}
            onChange={actions.setBody}
          />
        )}
      </Main>

      <ContentStorePublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={state.title}
        type={state.type}
        visibility={detail.visibility}
        description={state.description}
        isPublishing={isPublishing}
        onDescriptionChange={actions.setDescription}
        onPublish={(publishPublic) => actions.publishDraft(publishPublic)}
      />
    </>
  )
}
