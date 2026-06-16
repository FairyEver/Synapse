import type { DriveBrowserPreviewDto } from '@synapse/shared'
import { cn } from '@/lib/utils'

export function DriveSourceRenderer({
  preview,
  className,
}: {
  readonly preview: DriveBrowserPreviewDto
  readonly className?: string
}) {
  return (
    <div className={cn('py-6', className)}>
      <pre className='whitespace-pre-wrap break-words font-mono text-sm leading-6'>
        {preview.text}
      </pre>
      {preview.truncated ? (
        <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
    </div>
  )
}
