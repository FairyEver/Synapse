import { type QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Toast } from '@heroui/react';
import { NavigationProgress } from '@/components/navigation-progress';
import { GeneralError } from '@/features/errors/general-error';
import { NotFoundError } from '@/features/errors/not-found-error';
export const Route = createRootRouteWithContext<{
    queryClient: QueryClient;
}>()({
    component: () => {
        return (<>
        <NavigationProgress />
        <Outlet />
        <Toast.Provider />
      </>);
    },
    notFoundComponent: NotFoundError,
    errorComponent: GeneralError,
});
