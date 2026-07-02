import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
      <FileRendererShellChrome title={title}>
        {children}
      </FileRendererShellChrome>
    </FileRendererToolbarProvider>
  )
}

function FileRendererShellChrome({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const { items } = useFileRendererToolbar()
  return (
    <section className='flex h-full min-h-0 flex-col bg-background'>
      <div className='flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-3'>
        <div className='min-w-0 truncate text-sm font-medium'>{title}</div>
        <div className='flex shrink-0 items-center gap-2'>
          {items.map((item) => {
            if (item.kind === 'status') {
              return (
                <span key={item.id} className='text-xs text-muted-foreground'>
                  {item.label}
                </span>
              )
            }
            const icon = item.loading ? Loader2 : item.icon
            const Icon = icon
            return item.href ? (
              <Button key={item.id} asChild variant={item.variant ?? 'default'} size='sm'>
                <a href={item.href}>
                  {Icon ? <Icon data-icon='inline-start' className={item.loading ? 'animate-spin' : undefined} /> : null}
                  {item.label}
                </a>
              </Button>
            ) : (
              <Button
                key={item.id}
                type='button'
                variant={item.variant ?? 'default'}
                size='sm'
                disabled={item.disabled || item.loading}
                onClick={item.onClick}
              >
                {Icon ? <Icon data-icon='inline-start' className={item.loading ? 'animate-spin' : undefined} /> : null}
                {item.label}
              </Button>
            )
          })}
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {children}
      </div>
    </section>
  )
}
