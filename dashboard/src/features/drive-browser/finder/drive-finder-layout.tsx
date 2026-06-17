import type { ReactNode } from 'react'

export function DriveFinderFullLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div data-drive-finder='full' className='min-h-0 flex-1 overflow-hidden rounded-md border bg-background'>
      {children}
    </div>
  )
}

export function DriveFinderFileLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-drive-finder='file'
      data-drive-renderer-region='true'
      className='min-h-0 flex-1 overflow-hidden rounded-md border bg-background'
    >
      {children}
    </div>
  )
}
