import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FileBrowserBreadcrumb } from './file-browser-model'

export function FileBrowserBreadcrumbs({
  breadcrumbs,
  onNavigate,
}: {
  readonly breadcrumbs: readonly FileBrowserBreadcrumb[]
  readonly onNavigate: (path: string) => void
}) {
  return (
    <nav aria-label='文件路径' className='flex min-w-0 items-center gap-1 text-sm'>
      {breadcrumbs.map((breadcrumb, index) => {
        const current = index === breadcrumbs.length - 1
        return (
          <span key={breadcrumb.path || 'root'} className='flex min-w-0 items-center gap-1'>
            {index > 0 ? <ChevronRight className='size-4 shrink-0 text-muted-foreground' /> : null}
            {current ? (
              <span className='min-w-0 truncate font-medium'>{breadcrumb.name}</span>
            ) : (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-8 px-2'
                onClick={() => onNavigate(breadcrumb.path)}
              >
                {breadcrumb.name}
              </Button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
