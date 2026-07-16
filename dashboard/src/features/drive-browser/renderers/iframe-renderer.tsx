import type { DriveBrowserItemDto } from '@synapse/shared'

const DRIVE_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock'
const DRIVE_IFRAME_ALLOW = 'clipboard-write *'

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
      allow={DRIVE_IFRAME_ALLOW}
      sandbox={DRIVE_IFRAME_SANDBOX}
    />
  )
}
