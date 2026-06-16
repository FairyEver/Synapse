import type { DriveBrowserItemDto } from '@synapse/shared'

export function DriveIframeRenderer({
  current,
  visitUrl,
}: {
  readonly current: DriveBrowserItemDto
  readonly visitUrl: string
}) {
  return (
    <iframe
      title={current.name}
      src={visitUrl}
      className='h-full min-h-0 w-full border-0 bg-background'
      sandbox='allow-same-origin allow-scripts'
    />
  )
}
