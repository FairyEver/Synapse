import { type ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type LogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  alt?: string
}

const synapseLogoPath = `${import.meta.env.BASE_URL}synapse-logo.png`

export function Logo({ className, alt = 'Synapse', ...props }: LogoProps) {
  return (
    <img
      src={synapseLogoPath}
      alt={alt}
      className={cn('size-6 rounded-lg', className)}
      {...props}
    />
  )
}
