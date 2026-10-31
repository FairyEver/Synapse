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
            <>
              <div ref={refCallback} className={cn('truncate', className)}>
                {children}
              </div>
            </>
            <Tooltip.Content>
              <p className={contentClassName}>{children}</p>
            </Tooltip.Content>
          </Tooltip>
        </>
      </div>
      <div className='sm:hidden'>
        <Popover>
          <>
            <div ref={refCallback} className={cn('truncate', className)}>
              {children}
            </div>
          </>
          <Popover.Content className={cn('w-fit', contentClassName)}><Popover.Dialog>
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
