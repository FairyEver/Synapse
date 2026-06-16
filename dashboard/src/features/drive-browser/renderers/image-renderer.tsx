import type { DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'

export function DriveImageRenderer({
  current,
  preview,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
}) {
  return (
    <div className='flex min-h-0 items-center justify-center py-6'>
      {preview.imageUrl ? (
        <img
          src={preview.imageUrl}
          alt={current.name}
          className='max-h-screen max-w-full rounded-md object-contain'
        />
      ) : (
        <div className='text-sm text-muted-foreground'>图片不可预览</div>
      )}
    </div>
  )
}
