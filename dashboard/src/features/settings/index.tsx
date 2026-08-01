import { Link, Outlet, useLocation, type LinkProps } from '@tanstack/react-router'
import { UserCog, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

type SettingsNavItem = {
  title: string
  href: LinkProps['to']
  icon: LucideIcon
}

const userSettingsNavItems: SettingsNavItem[] = [
  {
    title: '个人资料',
    href: '/settings',
    icon: UserCog,
  },
]

export default function SettingsPage() {
  const navItems = userSettingsNavItems

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>设置</h1>
      </Header>

      <Main fixed>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>设置</h2>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div
          className={cn(
            'flex flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:gap-12',
            navItems.length === 0 && 'lg:block'
          )}
        >
          {navItems.length > 0 ? (
            <aside className='lg:w-1/5'>
              <SettingsSidebarNav items={navItems} />
            </aside>
          ) : null}
          <div className='flex w-full overflow-y-hidden p-1'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}

function SettingsSidebarNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = useLocation({ select: (location) => location.pathname })

  return (
    <nav className='flex gap-2 overflow-x-auto py-1 lg:flex-col lg:gap-1'>
      {items.map((item) => {
        const Icon = item.icon

        return (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              pathname === item.href && 'bg-muted hover:bg-accent',
              'justify-start'
            )}
          >
            <Icon className='me-2 size-4' />
            {item.title}
          </Link>
        )
      })}
    </nav>
  )
}
