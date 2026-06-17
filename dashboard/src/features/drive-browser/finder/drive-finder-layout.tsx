import type { ReactNode } from 'react'

export function DriveFinderFullLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div data-drive-finder='full' className='min-h-0 flex-1 overflow-hidden rounded-md border bg-background'>
      {children}
    </div>
  )
}

export function DriveFinderSplitLayout({
  list,
  renderer,
}: {
  readonly list: ReactNode
  readonly renderer: ReactNode
}) {
  return (
    <div
      data-drive-finder='split'
      className='grid min-h-0 flex-1 overflow-hidden rounded-md border bg-background md:grid-cols-[minmax(260px,32%)_minmax(0,1fr)]'
    >
      <div className='min-h-0 border-b md:border-r md:border-b-0'>{list}</div>
      <div data-drive-renderer-region='true' className='min-h-0'>{renderer}</div>
    </div>
  )
}
