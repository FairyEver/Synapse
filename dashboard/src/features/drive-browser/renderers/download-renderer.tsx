import type { DriveBrowserItemDto } from '@synapse/shared'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DriveDownloadRenderer({ current }: { readonly current: DriveBrowserItemDto }) {
  return (
    <div className='flex flex-col items-start gap-3 py-8 text-sm'>
      <div className='font-medium'>{current.name}</div>
      <div className='text-muted-foreground'>此文件只能下载。</div>
      {current.downloadUrl ? (
        <Button asChild variant='outline' size='sm'>
          <a href={current.downloadUrl}>
            <Download data-icon='inline-start' />
            下载
          </a>
        </Button>
      ) : null}
    </div>
  )
}
