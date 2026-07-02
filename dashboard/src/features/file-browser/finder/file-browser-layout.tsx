import type { ReactNode } from 'react'

export function FileBrowserFullLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className='min-h-0 flex-1 overflow-hidden rounded-md border bg-background'>
      {children}
    </div>
  )
}

export function FileBrowserFileLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className='min-h-0 flex-1 overflow-hidden rounded-md border bg-background'>
      {children}
    </div>
  )
}
