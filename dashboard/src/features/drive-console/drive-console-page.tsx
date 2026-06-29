import { useState } from 'react'
import type { DriveBrowserSurface, DriveUsageDto } from '@synapse/shared'
import { Upload } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import {
  DriveBrowserPage,
  DriveSingleFileReaderView,
} from '@/features/drive-browser/drive-browser-page'
import { shouldRenderDriveSingleFileReader } from '@/features/drive-browser/shared/drive-view-model'
import { formatDriveBrowserBytes } from '@/features/drive-browser/shared/drive-format'
import { DriveFileTable, type DriveConsoleSystemView } from './drive-file-table'
import { useDriveConsole, type DriveConsoleState } from './use-drive-console'

export function DriveConsolePage() {
  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleRoot />
      </Main>
    </>
  )
}

export function DriveConsoleItemPage({
  itemId,
  surface = 'console',
}: {
  readonly itemId: string
  readonly surface?: DriveBrowserSurface
}) {
  if (surface === 'standalone') {
    return <DriveBrowserPage context='owner' itemId={itemId} surface='standalone' />
  }

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>网盘</h1>
      </Header>
      <Main fixed fluid>
        <DriveConsoleItem itemId={itemId} surface={surface} />
      </Main>
    </>
  )
}

function DriveConsoleRoot() {
  const state = useDriveConsole({ context: 'root' })
  return <DriveConsoleContent state={state} />
}

function DriveConsoleItem({ itemId, surface }: { readonly itemId: string; readonly surface: DriveBrowserSurface }) {
  const state = useDriveConsole({ context: 'item', itemId, surface })
  if (state.browser.status === 'ready' && shouldRenderDriveSingleFileReader(state.browser.snapshot)) {
    return <DriveSingleFileReaderView snapshot={state.browser.snapshot} editContext={state.browser} />
  }
  return <DriveConsoleContent state={state} />
}

function DriveConsoleContent({ state }: { readonly state: DriveConsoleState }) {
  const [activeView, setActiveView] = useState<DriveConsoleSystemView>('files')
  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <h2 className='text-base font-semibold'>我的空间</h2>
          <DriveUsage usage={state.usage} loading={state.usageLoading} />
        </div>
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button type='button' variant='outline' size='sm'>
            <Upload className='size-4' />
            上传文件
          </Button>
          <Button type='button' variant='outline' size='sm'>新建文件夹</Button>
          <Button type='button' variant='outline' size='sm'>我的分享</Button>
          <Button type='button' variant='outline' size='sm'>站点</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => { void state.refresh() }}>刷新</Button>
        </div>
      </div>
      {state.browser.status === 'loading' ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
      {state.browser.status === 'error' ? <div className='text-sm text-destructive'>{state.browser.message}</div> : null}
      {state.browser.status === 'ready' ? (
        <DriveFileTable snapshot={state.browser.snapshot} activeView={activeView} onOpenSystemView={setActiveView} />
      ) : null}
    </div>
  )
}

function DriveUsage({ usage, loading }: { readonly usage: DriveUsageDto | null; readonly loading: boolean }) {
  if (!usage) return loading ? <span className='text-xs text-muted-foreground'>用量加载中</span> : null
  return (
    <span className='text-xs text-muted-foreground'>
      {formatDriveBrowserBytes(usage.usedBytes)} / {formatDriveBrowserBytes(usage.quotaBytes)}
    </span>
  )
}
