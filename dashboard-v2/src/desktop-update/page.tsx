import { Button } from '@heroui/react';
import { useEffect, useRef } from 'react';
import { type UpdateHandoffState, useUpdateHandoff } from './use-update-handoff';
const actionLabelByState: Record<UpdateHandoffState, string> = {
    idle: '打开 Synapse 并更新',
    requesting: '正在申请更新凭证',
    opened: '再次打开 Synapse',
    error: '重试',
};
export function UpdateHandoffPage() {
    const { requestUpdate, state } = useUpdateHandoff();
    const actionButtonRef = useRef<HTMLButtonElement>(null);
    const previousStateRef = useRef(state);
    useEffect(() => {
        if (previousStateRef.current === 'requesting' && state !== 'requesting') {
            actionButtonRef.current?.focus();
        }
        previousStateRef.current = state;
    }, [state]);
    return (<main className='flex min-h-svh items-center justify-center px-6 py-12'>
      <section aria-labelledby='desktop-update-title' aria-busy={state === 'requesting'} className='flex w-full max-w-md flex-col gap-6'>
        <div className='space-y-2'>
          <h1 id='desktop-update-title' className='text-2xl font-semibold'>更新 Synapse</h1>
          <p className='text-sm text-muted'>
            更新将关闭并重新启动 Synapse，请先结束正在进行的任务。
          </p>
        </div>

        <Button ref={actionButtonRef} type='button' size='lg' isPending={state === 'requesting'} isDisabled={state === 'requesting'} aria-live='polite' onPress={() => { void requestUpdate(); }}>
          {actionLabelByState[state]}
        </Button>

        {state === 'error' && (<p role='alert' className='text-sm text-danger'>
            暂时无法打开 Synapse，请重试。
          </p>)}

        <p className='text-sm text-muted'>
          如果没有自动打开软件更新页面，请在 Synapse 中前往“设置 → 关于 Synapse”检查更新。
        </p>
      </section>
    </main>);
}
