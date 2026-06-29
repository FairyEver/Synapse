import { useEffect, useState } from 'react'
import type { ContentStoreType } from '@synapse/shared'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import {
  canChangeMyContentVisibility,
  canSetContentPublic,
} from '../content-store-actions'
import { getContentStoreTypeLabel } from '../content-store-display'
import { confirmContentVisibilityChange } from './content-store-editor-actions'
import { ContentStorePublishDialog } from './content-store-publish-dialog'
import { RulePromptEditor } from './rule-prompt-editor'
import { SkillFileEditor } from './skill-file-editor'
import { SkillFileTree } from './skill-file-tree'
import { useContentStoreDraftEditor } from './use-content-store-draft-editor'

type ContentStoreEditorPageProps = {
  contentId: string
}

export function ContentStoreEditorPage({
  contentId,
}: ContentStoreEditorPageProps) {
  const navigate = useNavigate()
  const {
    detail,
    state,
    isLoading,
    error,
    actions,
    isSaving,
    isPublishing,
    isSettingVisibility,
  } = useContentStoreDraftEditor({ contentId })
  const [publishOpen, setPublishOpen] = useState(false)
  const [visibilityTarget, setVisibilityTarget] = useState<'private' | 'public' | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const canChangeVisibility =
    detail
      ? canChangeMyContentVisibility(detail) &&
        (detail.visibility === 'public' || canSetContentPublic(detail))
      : false

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
          <Alert className='max-w-xl'>
            <AlertTitle>内容不可用</AlertTitle>
            <AlertDescription>
              <Button
                variant='outline'
                size='sm'
                onClick={() => window.location.reload()}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
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
        <Main fixed fluid className='gap-4 pb-4'>
          <div className='grid min-h-0 flex-1 grid-rows-[20rem_28rem_18rem] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)_18rem] lg:grid-rows-none lg:overflow-hidden'>
            <Skeleton className='min-h-0 rounded-lg' />
            <Skeleton className='min-h-0 rounded-lg' />
            <Skeleton className='min-h-0 rounded-lg' />
          </div>
        </Main>
      </>
    )
  }

  const isSkill = state.type === 'skill'

  return (
    <>
      <Header fixed>
        <div className='flex min-w-0 flex-1 items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-3'>
            <Button
              variant='ghost'
              size='icon'
              onClick={() =>
                void navigate({
                  to: '/my-content/$contentId',
                  params: { contentId },
                })
              }
              aria-label='返回内容详情'
            >
              <ArrowLeft data-icon='inline-start' />
            </Button>
            <div className='flex min-w-0 items-center gap-2'>
              <h1 className='truncate text-lg font-semibold'>
                {isSkill ? state.title || '编辑内容' : '编辑内容'}
              </h1>
              {isSkill ? (
                <Badge variant='secondary'>
                  {getContentStoreTypeLabel(state.type as ContentStoreType)}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void actions.saveDraft()}
              disabled={isSaving}
            >
              <Save data-icon='inline-start' />
              {isSaving ? '保存中' : '保存'}
            </Button>
            <Button
              size='sm'
              onClick={() => setPublishOpen(true)}
              disabled={isPublishing}
            >
              {isPublishing ? '发布中' : '发布'}
            </Button>
          </div>
        </div>
      </Header>
      <Main fixed fluid className='gap-4 pb-4 max-lg:overflow-auto'>
        {isSkill ? (
          <section className='grid min-h-0 grid-rows-[32rem_32rem_22rem] gap-4 lg:flex-1 lg:grid-cols-[20rem_minmax(0,1fr)_18rem] lg:grid-rows-none lg:overflow-hidden'>
            <SkillFileTree
              files={state.files}
              selectedPath={selectedPath ?? state.files[0]?.path ?? null}
              onSelect={setSelectedPath}
              onFilesChange={(files) => {
                actions.setFiles(files)
                setSelectedPath(
                  files.find((file) => file.path === selectedPath)?.path ??
                    files[0]?.path ??
                    null
                )
              }}
            />
            <SkillFileEditor
              files={state.files}
              selectedPath={selectedPath ?? state.files[0]?.path ?? null}
              onFilesChange={(files) => {
                actions.setFiles(files)
                setSelectedPath(
                  files.find((file) => file.path === selectedPath)?.path ??
                    files[0]?.path ??
                    null
                )
              }}
            />
            <ContentMetadataPanel
              title={state.title}
              description={state.description}
              visibility={detail.visibility}
              isSettingVisibility={isSettingVisibility}
              onTitleChange={actions.setTitle}
              onDescriptionChange={actions.setDescription}
              onVisibilityChange={setVisibilityTarget}
            />
          </section>
        ) : (
          <>
            <section className='grid shrink-0 gap-4 rounded-lg border bg-card p-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)_10rem]'>
              <div className='grid gap-2'>
                <Label htmlFor='content-title'>标题</Label>
                <Input
                  id='content-title'
                  value={state.title}
                  onChange={(event) => actions.setTitle(event.target.value)}
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='content-description'>描述</Label>
                <Textarea
                  id='content-description'
                  value={state.description}
                  onChange={(event) => actions.setDescription(event.target.value)}
                  className='min-h-20 resize-y'
                />
              </div>
              <div className='grid content-end gap-2'>
                <Label htmlFor='content-visibility'>公开</Label>
                <div className='flex h-9 items-center justify-between gap-3 rounded-md border px-3'>
                  <span className='text-sm text-muted-foreground'>
                    {detail.visibility === 'public' ? '公开' : '私有'}
                  </span>
                  <Switch
                    id='content-visibility'
                    checked={detail.visibility === 'public'}
                    disabled={isSettingVisibility || !canChangeVisibility}
                    onCheckedChange={(checked) =>
                      setVisibilityTarget(checked ? 'public' : 'private')
                    }
                  />
                </div>
              </div>
            </section>
            <RulePromptEditor
              id='content-body'
              label='正文'
              value={state.body}
              onChange={actions.setBody}
            />
          </>
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
      <ConfirmDialog
        open={Boolean(visibilityTarget)}
        onOpenChange={(open) => {
          if (!open) setVisibilityTarget(null)
        }}
        title={visibilityTarget
          ? getVisibilityDialogTitle(visibilityTarget)
          : '更新可见性'}
        desc={visibilityTarget
          ? `${state.title || detail.title} 将变为${getVisibilityLabel(visibilityTarget)}。`
          : ''}
        confirmText={visibilityTarget
          ? getVisibilityDialogConfirmText(visibilityTarget)
          : '确认'}
        cancelBtnText='取消'
        destructive={visibilityTarget === 'private'}
        isLoading={isSettingVisibility}
        handleConfirm={() => {
          void confirmContentVisibilityChange({
            visibilityTarget,
            setVisibility: actions.setVisibility,
            clearVisibilityTarget: () => setVisibilityTarget(null),
            notifyError: toast.error,
          })
        }}
      />
    </>
  )
}

type ContentMetadataPanelProps = {
  title: string
  description: string
  visibility: 'private' | 'public'
  isSettingVisibility: boolean
  onTitleChange: (title: string) => void
  onDescriptionChange: (description: string) => void
  onVisibilityChange: (visibility: 'private' | 'public') => void
}

function ContentMetadataPanel({
  title,
  description,
  visibility,
  isSettingVisibility,
  onTitleChange,
  onDescriptionChange,
  onVisibilityChange,
}: ContentMetadataPanelProps) {
  return (
    <aside
      aria-label='内容属性'
      className='flex h-full min-h-0 flex-col gap-4 overflow-auto rounded-lg border bg-card p-4'
    >
      <div className='text-sm font-semibold'>属性</div>
      <div className='grid gap-2'>
        <Label htmlFor='content-title'>标题</Label>
        <Input
          id='content-title'
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </div>
      <div className='grid gap-2'>
        <Label htmlFor='content-description'>描述</Label>
        <Textarea
          id='content-description'
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className='min-h-28 resize-y'
        />
      </div>
      <div className='flex h-9 items-center justify-between gap-3 rounded-md border px-3'>
        <span className='text-sm font-medium'>公开</span>
        <Switch
          checked={visibility === 'public'}
          disabled={isSettingVisibility}
          onCheckedChange={(checked) =>
            onVisibilityChange(checked ? 'public' : 'private')
          }
        />
      </div>
    </aside>
  )
}

function getVisibilityLabel(visibility: 'private' | 'public') {
  return visibility === 'public' ? '公开' : '私有'
}

function getVisibilityDialogTitle(visibility: 'private' | 'public') {
  return visibility === 'public' ? '公开内容' : '取消公开'
}

function getVisibilityDialogConfirmText(visibility: 'private' | 'public') {
  return visibility === 'public' ? '公开' : '取消公开'
}
