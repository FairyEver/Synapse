import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDriveDiscussionNotification } from './use-drive-discussion-notification'

export function DriveDiscussionNotificationPage({ notificationId }: { notificationId: string }) {
  const state = useDriveDiscussionNotification(notificationId)
  return <main className='mx-auto flex max-w-xl flex-col gap-4 p-6'>
    {state.status === 'loading' || state.status === 'ready' ? <Skeleton className='h-16 w-full' aria-label='加载中' /> : <>
      <Alert><AlertDescription>{state.error}</AlertDescription></Alert>
      {state.status === 'error' ? <Button onClick={state.retry}>重试</Button> : null}
    </>}
  </main>
}
