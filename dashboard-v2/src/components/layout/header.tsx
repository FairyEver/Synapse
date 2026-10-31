import type { HTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/utils';
import { SidebarToggle } from './app-shell';
type HeaderProps = HTMLAttributes<HTMLElement> & {
    fixed?: boolean;
    ref?: Ref<HTMLElement>;
};
export function Header({ className, fixed = true, children, ...props }: HeaderProps) {
    return <header {...props} className={cn('z-20 flex shrink-0 items-center gap-3 bg-background px-6 py-5 [&_h1]:text-xl [&_h1]:font-semibold', fixed && 'sticky top-0', className)}><SidebarToggle />{children}</header>;
}
