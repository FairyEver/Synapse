import { Alert, Button, Spinner } from '@heroui/react'
import { useEffect, useState, type ComponentType } from 'react'
import { trackDriveEvent } from './drive-telemetry'

/** Keep failed module downloads retryable while the caller owns its draft/state. */
export function createDriveLazyComponent<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>, Fallback?: ComponentType<Props>): ComponentType<Props> {
  let loaded: ComponentType<Props> | null = null
  let pending: Promise<{ default: ComponentType<Props> }> | null = null
  return function DriveLazyComponent(props: Props) {
    const [state, setState] = useState<{ component: ComponentType<Props> | null; failed: boolean }>({ component: loaded, failed: false })
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
      if (loaded) { setState({ component: loaded, failed: false }); return }
      let active = true
      setState({ component: null, failed: false })
      pending ??= load().then((module) => { loaded = module.default; return module }, (error: unknown) => { pending = null; throw error })
      void pending.then(
        (module) => { if (active) setState({ component: module.default, failed: false }) },
        () => {
          if (active) {
            trackDriveEvent({ eventKey: 'web.drive.module.load', component: 'drive-module', category: 'error', action: 'open', outcome: 'failure' })
            setState({ component: null, failed: true })
          }
        },
      )
      return () => { active = false }
    }, [attempt])
    if (state.component) { const Component = state.component; return <Component {...props} /> }
    if (state.failed) return (
      <Alert status='danger'>
        <Alert.Content><Alert.Title>加载失败</Alert.Title></Alert.Content>
        <Button variant='secondary' onPress={() => setAttempt((value) => value + 1)}>重试</Button>
      </Alert>
    )
    if (Fallback) return <Fallback {...props} />
    return <div role='status' aria-label='加载中' className='flex items-center justify-center p-4'><Spinner /></div>
  }
}
