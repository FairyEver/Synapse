import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { Avatar, Button, Drawer, ScrollShadow, toast } from '@heroui/react';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { adminApi, dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useAdminAuthStore } from '@/stores/admin-auth-store';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { adminNavigation, userNavigation, getActiveNavigationPath } from './navigation';
const SidebarContext = createContext<() => void>(() => undefined);
export function SidebarToggle() {
    const toggle = useContext(SidebarContext);
    return <Button isIconOnly variant="ghost" aria-label='切换导航' onPress={toggle}><PanelLeftOpen /></Button>;
}
export function AppShell({ mode, children }: {
    mode: 'user' | 'admin';
    children: ReactNode;
}) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [signOutOpen, setSignOutOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const location = useLocation();
    const user = useAuthStore((s) => s.auth.user);
    const items = mode === 'admin' ? adminNavigation : userNavigation;
    const base = mode === 'admin' ? '/admin' : '/console';
    const name = mode === 'admin' ? '平台管理员' : user?.handle || user?.email || '账户';
    const toggle = () => {
        if (window.matchMedia('(min-width: 768px)').matches)
            setCollapsed(!collapsed);
        else
            setMobileOpen(!mobileOpen);
    };
    const signOut = async () => {
        setSigningOut(true);
        try {
            if (mode === 'admin') {
                await adminApi.logout();
                useAdminAuthStore.getState().auth.reset();
            }
            else {
                await dashboardApi.logout();
                useAuthStore.getState().auth.reset();
            }
            window.location.assign(`${base}/${mode === 'admin' ? 'access' : 'sign-in'}`);
        }
        catch (error) {
            toast.danger(error instanceof Error ? error.message : '退出失败，请重试');
        }
        finally {
            setSigningOut(false);
        }
    };
    const pathname = location.pathname.startsWith(`${base}/`) ? location.pathname.slice(base.length) : location.pathname;
    const activePath = getActiveNavigationPath(items, pathname);
    const navigation = <div className='flex h-full min-h-0 flex-col gap-5 p-4'>
    <div className='flex items-center gap-3 px-2 py-3'><Avatar><Avatar.Fallback>{name.slice(0, 1).toUpperCase()}</Avatar.Fallback></Avatar><div className='min-w-0'><div className='truncate font-semibold'>{name}</div><div className='truncate text-sm text-muted'>{mode === 'admin' ? 'Synapse 管理' : user?.email}</div></div></div>
    <ScrollShadow className='min-h-0 flex-1'><nav aria-label={mode === 'admin' ? '管理导航' : '账户导航'} className='flex flex-col gap-1'>
      {items.map(({ title, path, icon: Icon, external }) => {
        const active = path === activePath;
        const href = external ? path : `${base}${path}`;
        return <Button key={path} variant={active ? 'secondary' : 'ghost'} fullWidth className='justify-start' aria-current={active ? 'page' : undefined} onPress={() => { if (external) window.open(href, '_blank', 'noopener,noreferrer'); else window.location.assign(href) }}><Icon className='size-5 shrink-0' />{title}</Button>;
      })}
    </nav></ScrollShadow>
    <Button variant="ghost" className='justify-start' onPress={() => setSignOutOpen(true)}><LogOut className='size-5'/>退出登录</Button>
  </div>;
    return <SidebarContext value={toggle}>
    <a href='#main-content' className='sr-only focus:not-sr-only'>跳转到内容</a>
    <div className='flex h-svh min-h-0 overflow-hidden'>
      {!collapsed && <aside className='hidden w-64 shrink-0 border-r border-separator md:block'>{navigation}</aside>}
      <Drawer.Backdrop isOpen={mobileOpen} onOpenChange={setMobileOpen}><Drawer.Content placement='left'><Drawer.Dialog aria-label='导航'><Drawer.CloseTrigger />{navigation}</Drawer.Dialog></Drawer.Content></Drawer.Backdrop>
      <div id='main-content' className='@container/content flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto'>{children}</div>
      {collapsed && <Button isIconOnly variant="secondary" className='fixed bottom-4 left-4' aria-label='展开导航' onPress={toggle}><PanelLeftClose /></Button>}
    </div>
    <ConfirmDialog open={signOutOpen} onOpenChange={setSignOutOpen} title='退出登录' desc='确认退出当前会话？' confirmText='退出登录' isLoading={signingOut} handleConfirm={() => void signOut()}/>
  </SidebarContext>;
}
