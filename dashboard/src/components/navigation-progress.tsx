import { Spinner } from '@heroui/react';
import { useRouterState } from '@tanstack/react-router';
export function NavigationProgress() {
    const pending = useRouterState({ select: (state) => state.status === 'pending' });
    return pending ? <Spinner className='fixed top-4 right-4 z-50' aria-label='页面加载中'/> : null;
}
