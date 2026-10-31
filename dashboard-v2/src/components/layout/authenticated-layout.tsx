import { Outlet, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppShell } from './app-shell';
export function isStandaloneDriveReaderHref(href: string) {
    return new URL(href, 'http://synapse.local').pathname.startsWith('/drive/items/');
}
export function AuthenticatedLayout({ children }: {
    children?: ReactNode;
}) {
    const href = useLocation({ select: (location) => location.href });
    const content = children ?? <Outlet />;
    return isStandaloneDriveReaderHref(href) ? content : <AppShell mode='user'>{content}</AppShell>;
}
