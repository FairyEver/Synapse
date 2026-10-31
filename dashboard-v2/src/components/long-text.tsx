import { Popover, Tooltip } from '@heroui/react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
type LongTextProps = {
    children: React.ReactNode;
    className?: string;
    contentClassName?: string;
};
export function LongText({ children, className = '', contentClassName = '', }: LongTextProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [isOverflown, setIsOverflown] = useState(false);
    // Use ref callback to check overflow when element is mounted
    const refCallback = (node: HTMLDivElement | null) => {
        ref.current = node;
        if (node && checkOverflow(node)) {
            queueMicrotask(() => setIsOverflown(true));
        }
    };
    if (!isOverflown)
        return (<div ref={refCallback} className={cn('truncate', className)}>
        {children}
      </div>);
    return (<>
      <div className='hidden sm:block'>
        <>
          <Tooltip>
            <Tooltip.Trigger className='min-w-0 max-w-full'>
              <div ref={refCallback} className={cn('truncate', className)}>
                {children}
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content className='max-w-80 whitespace-normal break-words'>
              <p className={contentClassName}>{children}</p>
            </Tooltip.Content>
          </Tooltip>
        </>
      </div>
      <div className='sm:hidden'>
        <Popover>
          <Popover.Trigger className='min-w-0 max-w-full'>
            <div ref={refCallback} className={cn('truncate', className)}>
              {children}
            </div>
          </Popover.Trigger>
          <Popover.Content className={cn('max-w-80 whitespace-normal break-words', contentClassName)}><Popover.Dialog>
            <p>{children}</p>
          </Popover.Dialog></Popover.Content>
        </Popover>
      </div>
    </>);
}
const checkOverflow = (textContainer: HTMLDivElement | null) => {
    if (textContainer) {
        return (textContainer.offsetHeight < textContainer.scrollHeight ||
            textContainer.offsetWidth < textContainer.scrollWidth);
    }
    return false;
};
