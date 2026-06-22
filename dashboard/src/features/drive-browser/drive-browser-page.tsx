import { useEffect, useState } from 'react'
import type {
  DriveBrowserSnapshotDto,
  DriveBrowserSurface,
} from '@synapse/shared'
import { Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { DriveFinder } from './finder/drive-finder'
import { DriveRendererShell } from './renderers/drive-renderer-shell'
import type { DriveRendererEditContext } from './renderers/drive-renderer-shell'
import type { DriveRendererId } from './renderers/drive-renderer-registry'
import { shouldRenderDriveBodyRenderer } from './shared/drive-view-model'
import type { DriveAnnotationContext } from './use-drive-annotations'
import { useDriveBrowser } from './use-drive-browser'

export type DriveBrowserPageProps =
  | {
      context: 'owner'
      surface: DriveBrowserSurface
      itemId: string
    }
  | {
      context: 'share'
      shareId: string
      itemId?: string
      initialPassword?: string
      onInitialPasswordConsumed?: () => void
    }

type DriveBrowserLayoutMode = 'auto' | 'fixed'
type DriveBrowserLoadingMode = 'card' | 'reader'

export function DriveBrowserPage(props: DriveBrowserPageProps) {
  const state = useDriveBrowser(props)
  const initialPassword = props.context === 'share' ? props.initialPassword : undefined
  const onInitialPasswordConsumed = props.context === 'share'
    ? props.onInitialPasswordConsumed
    : undefined

  useEffect(() => {
    if (!initialPassword) return
    if (state.status !== 'ready' && state.status !== 'passwordRequired') return
    onInitialPasswordConsumed?.()
  }, [initialPassword, onInitialPasswordConsumed, state.status])

  const framed = props.context === 'share' || props.surface === 'standalone'
  const loadingMode: DriveBrowserLoadingMode = framed
    ? 'reader'
    : 'card'
  const layoutMode: DriveBrowserLayoutMode = framed ? 'auto' : 'fixed'
  const shouldCenterState = framed && state.status !== 'ready' && state.status !== 'loading'
  const annotationContext: DriveAnnotationContext | undefined = state.status === 'ready'
    ? props.context === 'owner'
      ? { context: 'owner', itemId: state.snapshot.current.id }
      : { context: 'share', shareId: props.shareId, itemId: state.snapshot.current.id, canWrite: Boolean(state.snapshot.edit?.canEdit) }
    : undefined
  if (state.status === 'ready' && shouldRenderDriveBodyRenderer(state.snapshot)) {
    return <DriveSingleFileReaderView snapshot={state.snapshot} editContext={state} annotationContext={annotationContext} />
  }

  const content = (
    <div
      className={cn(
        'mx-auto flex min-h-0 w-full flex-col gap-3',
        shouldCenterState
          ? 'max-w-md flex-1 justify-center'
          : state.status === 'loading' && loadingMode === 'reader'
            ? 'max-w-4xl flex-1'
            : layoutMode === 'fixed'
              ? 'flex-1 overflow-hidden'
              : 'max-w-7xl'
      )}
    >
      {state.status === 'loading' ? <DriveBrowserLoading mode={loadingMode} /> : null}
      {state.status === 'error' ? <DriveBrowserError message={state.message} /> : null}
      {state.status === 'passwordRequired' ? (
        <DriveBrowserPasswordForm
          message={state.message}
          unlocking={state.unlocking}
          unlockError={state.unlockError}
          onUnlock={state.unlock}
        />
      ) : null}
      {state.status === 'ready' ? (
        <DriveBrowserView
          snapshot={state.snapshot}
          layoutMode={layoutMode}
          onLoadMoreChildren={state.loadMoreChildren}
          loadingMoreChildren={state.loadingMoreChildren}
          loadMoreChildrenError={state.loadMoreChildrenError}
          editContext={state}
          annotationContext={annotationContext}
        />
      ) : null}
    </div>
  )

  if (!framed) return content
  return <main className='flex min-h-svh bg-background p-4 md:p-6'>{content}</main>
}

export function DriveConsoleBrowserPage(props: Omit<Extract<DriveBrowserPageProps, { context: 'owner' }>, 'context' | 'surface'>) {
  return <DriveBrowserPage {...props} context='owner' surface='console' />
}

export {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'

export function DriveConsoleRootBrowser() {
  const state = useDriveBrowser({ context: 'console-root' })
  if (state.status === 'loading') return <DriveBrowserLoading mode='card' />
  if (state.status === 'error') return <DriveBrowserError message={state.message} />
  if (state.status !== 'ready') return null
  return (
    <DriveBrowserView
      snapshot={state.snapshot}
      layoutMode='fixed'
      onLoadMoreChildren={state.loadMoreChildren}
      loadingMoreChildren={state.loadingMoreChildren}
      loadMoreChildrenError={state.loadMoreChildrenError}
      editContext={state}
    />
  )
}

export function DriveBrowserView({
  snapshot,
  layoutMode = 'auto',
  onLoadMoreChildren,
  loadingMoreChildren = false,
  loadMoreChildrenError = null,
  editContext,
  annotationContext,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly layoutMode?: DriveBrowserLayoutMode
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
}) {
  void layoutMode
  return (
    <DriveFinder
      snapshot={snapshot}
      mode={snapshot.context === 'share' ? 'share' : snapshot.surface}
      onLoadMoreChildren={onLoadMoreChildren}
      loadingMoreChildren={loadingMoreChildren}
      loadMoreChildrenError={loadMoreChildrenError}
      editContext={editContext}
      annotationContext={annotationContext}
    />
  )
}

export function DriveSingleFileReaderView({
  snapshot,
  embedded = false,
  initialRendererId = null,
  editContext,
  annotationContext,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly embedded?: boolean
  readonly initialRendererId?: DriveRendererId | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
}) {
  void embedded
  return (
    <div className='h-svh min-h-0 overflow-hidden bg-background'>
      <DriveRendererShell
        snapshot={snapshot}
        body
        initialRendererId={initialRendererId}
        editContext={editContext}
        annotationContext={annotationContext}
      />
    </div>
  )
}

function DriveBrowserPasswordForm({
  message,
  unlocking,
  unlockError,
  onUnlock,
}: {
  readonly message: string
  readonly unlocking: boolean
  readonly unlockError: string | null
  readonly onUnlock: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  const passwordInputId = 'drive-share-password'
  const passwordHelpId = 'drive-share-password-help'
  const passwordErrorId = 'drive-share-password-error'
  const unlockErrorMessage = unlockError === message ? '密码不正确，请重试。' : unlockError
  return (
    <form
      className='flex w-full flex-col gap-4 rounded-lg border bg-background p-5'
      onSubmit={(event) => {
        event.preventDefault()
        onUnlock(password)
      }}
    >
      <div className='space-y-1.5'>
        <h1 className='text-base font-semibold'>输入访问密码</h1>
        <p id={passwordHelpId} className='text-sm text-muted-foreground'>{message}</p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor={passwordInputId}>密码</Label>
        <Input
          id={passwordInputId}
          type='password'
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete='current-password'
          autoFocus
          aria-invalid={Boolean(unlockError)}
          aria-describedby={unlockError ? passwordErrorId : passwordHelpId}
        />
      </div>
      {unlockErrorMessage ? (
        <Alert id={passwordErrorId} variant='destructive' aria-live='polite'>
          <AlertDescription>{unlockErrorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <Button type='submit' disabled={unlocking || password.length === 0}>
        {unlocking ? <Loader2 className='animate-spin' /> : null}
        {unlocking ? '验证中' : '打开'}
      </Button>
    </form>
  )
}

function DriveBrowserLoading({ mode }: { readonly mode: DriveBrowserLoadingMode }) {
  if (mode === 'reader') return <DriveReaderLoading />

  return (
    <div className='flex w-full flex-col gap-4 rounded-lg border bg-background p-5' aria-busy='true'>
      <div className='space-y-2'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-4 w-48' />
      </div>
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-40 w-full' />
    </div>
  )
}

function DriveReaderLoading() {
  return (
    <div className='w-full py-6' aria-busy='true'>
      <div className='space-y-6'>
        <div className='space-y-3'>
          <Skeleton className='h-8 w-2/3' />
          <Skeleton className='h-4 w-1/2' />
        </div>
        <div className='space-y-3'>
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-11/12' />
          <Skeleton className='h-4 w-10/12' />
        </div>
        <Skeleton className='h-56 w-full' />
      </div>
    </div>
  )
}

function DriveBrowserError({ message }: { readonly message: string }) {
  return (
    <Alert variant='destructive'>
      <AlertTitle>无法打开</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
