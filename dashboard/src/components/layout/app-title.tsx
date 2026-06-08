import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

type AppTitleProps = {
  name: string
  description: string
  logo: React.ElementType
}

export function AppTitle({ name, description, logo: Logo }: AppTitleProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size='lg'
          className='cursor-default hover:bg-transparent active:bg-transparent'
          asChild
        >
          <div>
            <div className='flex aspect-square size-8 items-center justify-center'>
              <Logo className='size-8' />
            </div>
            <div className='grid flex-1 text-start text-sm leading-tight'>
              <span className='truncate font-semibold'>{name}</span>
              <span className='truncate text-xs'>{description}</span>
            </div>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
