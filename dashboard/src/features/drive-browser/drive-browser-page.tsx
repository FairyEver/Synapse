import { useEffect, useRef, useState } from 'react'
import type {
  DriveBrowserSnapshotDto,
  DriveBrowserSurface,
} from '@synapse/shared'
import { Loader2 } from 'lucide-react'
import { Logo } from '@/assets/logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { cn } from '@/lib/utils'
import { DriveFinder } from './finder/drive-finder'
import { DriveRendererShell } from './renderers/drive-renderer-shell'
import type { DriveRendererEditContext } from './renderers/drive-renderer-shell'
import type { DriveRendererId } from './renderers/drive-renderer-registry'
import type { DriveBrowserNavigate } from './shared/drive-navigation'
import { DriveTelemetryBoundary } from './shared/drive-telemetry-boundary'
import { shouldRenderDriveBodyRenderer } from './shared/drive-view-model'
import type { DriveAnnotationContext } from './use-drive-annotations'
import { useDriveBrowser } from './use-drive-browser'

export type DriveBrowserPageProps =
  | {
      context: 'owner'
      surface: DriveBrowserSurface
      itemId: string
      onNavigate?: DriveBrowserNavigate
    }
  | {
      context: 'share'
      shareId: string
      itemId?: string
      initialPassword?: string
      onInitialPasswordConsumed?: () => void
      onNavigate?: DriveBrowserNavigate
    }

type DriveBrowserLayoutMode = 'auto' | 'fixed'
type DriveBrowserLoadingMode = 'card' | 'reader'

export function DriveBrowserPage(props: DriveBrowserPageProps) {
  return (
    <DriveTelemetryBoundary scope={props.context}>
      <DriveBrowserPageContent {...props} />
    </DriveTelemetryBoundary>
  )
}

function DriveBrowserPageContent(props: DriveBrowserPageProps) {
  const state = useDriveBrowser(props)
  const initialPassword = props.context === 'share' ? props.initialPassword : undefined
  const onInitialPasswordConsumed = props.context === 'share'
    ? props.onInitialPasswordConsumed
    : undefined
  const shareTargetKey = props.context === 'share'
    ? `${props.shareId}:${props.itemId ?? ''}`
    : null
  const [initialPasswordRejectedKey, setInitialPasswordRejectedKey] = useState<string | null>(null)
  const consumedInitialPasswordKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!initialPassword) {
      consumedInitialPasswordKeyRef.current = null
      return
    }
    if (state.status !== 'ready' && state.status !== 'passwordRequired') return
    if (consumedInitialPasswordKeyRef.current === shareTargetKey) return
    consumedInitialPasswordKeyRef.current = shareTargetKey
    if (state.status === 'passwordRequired' && initialPasswordRejectedKey !== shareTargetKey) setInitialPasswordRejectedKey(shareTargetKey)
    onInitialPasswordConsumed?.()
  }, [initialPassword, initialPasswordRejectedKey, onInitialPasswordConsumed, shareTargetKey, state.status])

  useEffect(() => {
    if (state.status === 'ready' && initialPasswordRejectedKey !== null) setInitialPasswordRejectedKey(null)
  }, [initialPasswordRejectedKey, state.status])

  const framed = props.context === 'share' || props.surface === 'standalone'
  const loadingMode: DriveBrowserLoadingMode = framed
    ? 'reader'
    : 'card'
  const layoutMode: DriveBrowserLayoutMode = framed ? 'auto' : 'fixed'
  const shouldCenterState = framed && state.status !== 'ready' && state.status !== 'loading'
  const annotationContext: DriveAnnotationContext | undefined = state.status === 'ready'
    ? props.context === 'owner'
      ? { context: 'owner', itemId: state.snapshot.current.id }
      : { context: 'share', shareId: props.shareId, itemId: state.snapshot.current.id, canComment: Boolean(state.snapshot.annotation?.canComment) }
    : undefined
  if (state.status === 'ready' && shouldRenderDriveBodyRenderer(state.snapshot)) {
    return <DriveSingleFileReaderView snapshot={state.snapshot} editContext={state} annotationContext={annotationContext} />
  }

  if (props.context === 'share' && state.status !== 'ready') {
    return (
      <DriveShareEntryLayout>
        {state.status === 'loading' ? <DriveShareEntryLoading /> : null}
        {state.status === 'invalidShare' ? <DriveShareInvalidState /> : null}
        {state.status === 'error' ? (
          <DriveShareErrorState
            message={state.message}
            retrying={state.retrying}
            onRetry={state.retry}
          />
        ) : null}
        {state.status === 'passwordRequired' ? (
          <DriveBrowserPasswordForm
            message={state.message}
            unlocking={state.unlocking}
            unlockError={state.unlockError ?? (initialPasswordRejectedKey === shareTargetKey ? state.message : null)}
            onUnlock={state.unlock}
          />
        ) : null}
      </DriveShareEntryLayout>
    )
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
      {state.status === 'error' ? (
        <DriveBrowserError
          message={state.message}
          retrying={state.retrying}
          onRetry={state.retry}
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
          onNavigate={props.onNavigate}
        />
      ) : null}
    </div>
  )

  if (!framed) return content
  return <main className='flex min-h-screen supports-[height:100svh]:min-h-svh bg-background p-4 md:p-6'>{content}</main>
}

export function DriveConsoleBrowserPage(props: Omit<Extract<DriveBrowserPageProps, { context: 'owner' }>, 'context' | 'surface'>) {
  return <DriveBrowserPageContent {...props} context='owner' surface='console' />
}

export {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'

export function DriveConsoleRootBrowser() {
  const state = useDriveBrowser({ context: 'console-root' })
  if (state.status === 'loading') return <DriveBrowserLoading mode='card' />
  if (state.status === 'error') {
    return <DriveBrowserError message={state.message} retrying={state.retrying} onRetry={state.retry} />
  }
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
  onNavigate,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly layoutMode?: DriveBrowserLayoutMode
  readonly onLoadMoreChildren?: () => void
  readonly loadingMoreChildren?: boolean
  readonly loadMoreChildrenError?: string | null
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
  readonly onNavigate?: DriveBrowserNavigate
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
      onNavigate={onNavigate}
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
  useDocumentTitle(snapshot.current.name)

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-hidden bg-background' : 'h-screen supports-[height:100svh]:h-svh min-h-0 overflow-hidden bg-background'}>
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

function DriveShareEntryLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className='flex min-h-screen supports-[height:100svh]:min-h-svh w-full bg-muted/30 px-4 py-8 sm:px-6'>
      <div className='mx-auto my-auto flex w-full max-w-sm flex-col gap-6'>
        <div className='flex items-center justify-center gap-2' aria-label='Synapse'>
          <Logo className='size-8' alt='' />
          <span className='text-lg font-semibold'>Synapse</span>
        </div>
        {children}
      </div>
    </main>
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
  const passwordErrorId = 'drive-share-password-error'
  const unlockErrorMessage = unlockError === message ? '密码不正确，请重试。' : unlockError
  return (
    <form
      data-drive-telemetry-event='web.drive.share.unlock'
      onSubmit={(event) => {
        event.preventDefault()
        if (unlocking || password.length === 0) return
        onUnlock(password)
      }}
    >
      <Card className='gap-5 shadow-none'>
        <CardHeader>
          <h1 className='text-lg font-semibold'>此分享受密码保护</h1>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div className='space-y-2'>
            <Label htmlFor={passwordInputId}>访问密码</Label>
            <Input
              id={passwordInputId}
              type='password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete='current-password'
              autoFocus
              required
              disabled={unlocking}
              aria-invalid={Boolean(unlockError)}
              aria-describedby={unlockError ? passwordErrorId : undefined}
            />
            {unlockErrorMessage ? (
              <p
                id={passwordErrorId}
                className='text-sm text-destructive'
                role='alert'
                aria-live='polite'
              >
                {unlockErrorMessage}
              </p>
            ) : null}
          </div>
          <Button className='w-full' type='submit' disabled={unlocking || password.length === 0}>
            {unlocking ? <Loader2 className='animate-spin' /> : null}
            {unlocking ? '正在打开' : '打开分享'}
          </Button>
        </CardContent>
      </Card>
    </form>
  )
}

function DriveShareEntryLoading() {
  return (
    <Card className='gap-5 shadow-none' aria-busy='true'>
      <CardHeader>
        <Skeleton className='h-6 w-44' />
      </CardHeader>
      <CardContent className='space-y-5'>
        <div className='space-y-2'>
          <Skeleton className='h-4 w-20' />
          <Skeleton className='h-9 w-full' />
        </div>
        <Skeleton className='h-9 w-full' />
      </CardContent>
    </Card>
  )
}

function DriveShareInvalidState() {
  return (
    <Card className='gap-2 shadow-none'>
      <CardHeader>
        <h1 className='text-lg font-semibold'>链接已失效</h1>
        <p className='text-sm text-muted-foreground'>请向文件所有者确认最新链接。</p>
      </CardHeader>
    </Card>
  )
}

function DriveShareErrorState({
  message,
  retrying,
  onRetry,
}: {
  readonly message: string
  readonly retrying: boolean
  readonly onRetry: () => void
}) {
  return (
    <Card className='gap-5 shadow-none'>
      <CardHeader>
        <h1 className='text-lg font-semibold'>无法打开分享</h1>
        <p className='text-sm text-muted-foreground'>{message}</p>
      </CardHeader>
      <CardContent>
        <Button className='w-full' type='button' variant='outline' disabled={retrying} onClick={onRetry}>
          {retrying ? <Loader2 className='animate-spin' /> : null}
          重试
        </Button>
      </CardContent>
    </Card>
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

function DriveBrowserError({
  message,
  retrying,
  onRetry,
}: {
  readonly message: string
  readonly retrying: boolean
  readonly onRetry: () => void
}) {
  return (
    <Alert variant='destructive'>
      <AlertTitle>无法打开</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <div className='mt-3'>
        <Button type='button' variant='outline' size='sm' disabled={retrying} onClick={onRetry}>
          {retrying ? <Loader2 className='animate-spin' /> : null}
          重试
        </Button>
      </div>
    </Alert>
  )
}
