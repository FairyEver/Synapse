import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const brandIconSrc = `${import.meta.env.BASE_URL}icons/synapse-icon.png`;

export function BrandIcon({ className, ...props }: ComponentProps<'img'>) {
  return (
    <img
      src={brandIconSrc}
      alt=""
      aria-hidden="true"
      className={cn('size-8 rounded-lg', className)}
      {...props}
    />
  );
}
