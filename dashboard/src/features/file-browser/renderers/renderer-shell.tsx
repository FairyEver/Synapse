import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  FilePreviewLayout,
  useFilePreviewLayoutMode,
} from '../preview/file-preview-layout'
import {
  FilePreviewToolbarItemView,
  FilePreviewToolbarMenuItems,
  getCompactOverflowToolbarItems,
  getCompactPrimaryToolbarItems,
} from '../preview/file-preview-toolbar'
import { FileRendererToolbarProvider, useFileRendererToolbar } from './renderer-toolbar-context'

export type FileRendererEditContext = {
  readonly reload: () => Promise<{ readonly text: string; readonly baseVersionId: string }>
  readonly reloading: boolean
  readonly saveText: (input: { readonly text: string; readonly baseVersionId: string }) => Promise<{ readonly baseVersionId: string }>
  readonly savingText: boolean
}

export function FileRendererShell({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <FileRendererToolbarProvider>
      <FilePreviewLayout className='h-full min-h-0 w-full overflow-hidden bg-background'>
        <FileRendererShellChrome title={title}>
          {children}
        </FileRendererShellChrome>
      </FilePreviewLayout>
    </FileRendererToolbarProvider>
  )
}

function FileRendererShellChrome({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const { items } = useFileRendererToolbar()
  const layoutMode = useFilePreviewLayoutMode()
  const primaryItems = getCompactPrimaryToolbarItems(items)
  const overflowItems = getCompactOverflowToolbarItems(items)

  return (
    <section className='flex h-full min-h-0 flex-col bg-background'>
      {layoutMode === 'compact' ? (
        <header data-file-preview-header='compact' className='shrink-0 border-b'>
          <div className='flex min-h-14 min-w-0 items-center gap-3 px-3'>
            <div className='min-w-0 flex-1 truncate text-sm font-medium'>{title}</div>
            {overflowItems.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type='button' variant='outline' size='icon' className='size-11' aria-label='更多操作'>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <FilePreviewToolbarMenuItems items={overflowItems} />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {primaryItems.length > 0 ? (
            <div className='flex min-h-14 max-w-full items-center gap-2 overflow-x-auto border-t px-3 py-1.5'>
              {primaryItems.map((item) => (
                <FilePreviewToolbarItemView
                  key={item.id}
                  item={item}
                  compact
                  defaultButtonVariant='default'
                />
              ))}
            </div>
          ) : null}
        </header>
      ) : (
        <div data-file-preview-header='regular' className='flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-3'>
          <div className='min-w-0 truncate text-sm font-medium'>{title}</div>
          <div className='flex shrink-0 items-center gap-2'>
            {items.map((item) => (
              <FilePreviewToolbarItemView
                key={item.id}
                item={item}
                defaultButtonVariant='default'
              />
            ))}
          </div>
        </div>
      )}
      <div className='min-h-0 flex-1 overflow-hidden'>
        {children}
      </div>
    </section>
  )
}
