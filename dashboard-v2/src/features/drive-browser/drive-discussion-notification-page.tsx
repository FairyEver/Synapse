import { Alert, Button, Skeleton } from '@heroui/react'
import { useDriveDiscussionNotification } from './use-drive-discussion-notification'
export function DriveDiscussionNotificationPage({
  notificationId,
}: {
  notificationId: string
}) {
  const state = useDriveDiscussionNotification(notificationId)
  return (
    <main className='mx-auto flex max-w-xl flex-col gap-4 p-6'>
      {state.status === 'loading' || state.status === 'ready' ? (
        <Skeleton className='h-16 w-full' aria-label='加载中' />
      ) : (
        <>
          <Alert>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{state.error}</Alert.Description>
            </Alert.Content>
          </Alert>
          {state.status === 'error' ? (
            <Button onPress={state.retry}>重试</Button>
          ) : null}
        </>
      )}
    </main>
  )
}
