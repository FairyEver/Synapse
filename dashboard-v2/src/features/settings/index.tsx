import { Tabs } from '@heroui/react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
export default function SettingsPage() {
    const pathname = useLocation({ select: (location) => location.pathname });
    const navigate = useNavigate();
    return <><Header><h1>设置</h1></Header><Main><Tabs selectedKey={pathname.replace(/\/$/u, '')} onSelectionChange={(key) => void navigate({ to: key as '/settings' | '/settings/api-keys' })}>
    <Tabs.ListContainer className='w-fit'><Tabs.List aria-label='账户设置'><Tabs.Tab id='/settings'>个人资料<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id='/settings/api-keys'>API 密钥<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer>
    <Tabs.Panel id='/settings'><Outlet /></Tabs.Panel><Tabs.Panel id='/settings/api-keys'><Outlet /></Tabs.Panel>
  </Tabs></Main></>;
}
