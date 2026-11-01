import { Outlet } from '@tanstack/react-router';
import { AppShell } from './app-shell';
export function AdminAuthenticatedLayout() { return <AppShell mode='admin'><Outlet /></AppShell>; }
