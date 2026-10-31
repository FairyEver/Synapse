import type { HTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/utils';
type MainProps = HTMLAttributes<HTMLElement> & {
    fixed?: boolean;
    fluid?: boolean;
    ref?: Ref<HTMLElement>;
};
export function Main({ fixed, fluid, className, ...props }: MainProps) {
    return <main {...props} data-layout={fixed ? 'fixed' : 'auto'} className={cn('flex min-h-0 w-full flex-1 flex-col gap-6 px-6 pb-6', !fluid && 'mx-auto max-w-screen-2xl', className)}/>;
}
