import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type PageState = 'idle' | 'requesting' | 'opened' | 'error'

interface UpdateIntentResponse {
  readonly deepLink: string
}

export function UpdateHandoffPage() {
  const [state, setState] = useState<PageState>('idle')
  const requestPendingRef = useRef(false)

  const requestUpdate = async () => {
    if (requestPendingRef.current) return
    requestPendingRef.current = true
    setState('requesting')

    try {
      const response = await fetch('/api/desktop/update-intent', { method: 'POST' })
      if (!response.ok) throw new Error('Update intent request failed')

      const result = await response.json() as UpdateIntentResponse
      if (typeof result.deepLink !== 'string') throw new Error('Invalid update intent response')

      window.open(result.deepLink, '_self')
      setState('opened')
    } catch {
      setState('error')
    } finally {
      requestPendingRef.current = false
    }
  }

  return (
    <main className='flex min-h-svh items-center justify-center px-6 py-12'>
      <section className='flex w-full max-w-md flex-col gap-6'>
        <div className='space-y-2'>
          <h1 className='text-2xl font-semibold'>更新 Synapse</h1>
          <p className='text-sm text-muted-foreground'>
            更新将关闭并重新启动 Synapse，请先结束正在进行的任务。
          </p>
        </div>

        <Button
          type='button'
          size='lg'
          disabled={state === 'requesting'}
          onClick={() => { void requestUpdate() }}
        >
          {state === 'requesting'
            ? '正在申请更新凭证'
            : state === 'opened'
              ? '再次打开 Synapse'
              : state === 'error'
                ? '重试'
                : '打开 Synapse 并更新'}
        </Button>

        {state === 'error' && (
          <p role='alert' className='text-sm text-destructive'>
            暂时无法打开 Synapse，请重试。
          </p>
        )}

        <p className='text-sm text-muted-foreground'>
          如果没有自动打开软件更新页面，请在 Synapse 中前往“设置 → 关于 Synapse”检查更新。
        </p>
      </section>
    </main>
  )
}
