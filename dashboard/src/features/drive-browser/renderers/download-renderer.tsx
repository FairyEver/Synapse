import type { DriveBrowserItemDto } from '@synapse/shared'
import { FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DriveDownloadRenderer({ current }: { readonly current: DriveBrowserItemDto }) {
  return (
    <div
      data-drive-download-state='true'
      className='flex min-h-full items-center justify-center px-4 py-12 text-center'
    >
      <div className='flex max-w-sm flex-col items-center'>
        <div
          className='mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground'
          aria-hidden='true'
        >
          <FileDown className='size-5' />
        </div>
        <h1 className='text-balance text-base font-semibold'>无法在线预览</h1>
        <p className='mt-1.5 text-pretty text-sm text-muted-foreground'>
          {current.downloadUrl
            ? '该文件格式暂不支持在线预览，请下载后查看。'
            : '该文件格式暂不支持在线预览。'}
        </p>
        {current.downloadUrl ? (
          <Button asChild size='lg' className='mt-5'>
            <a href={current.downloadUrl}>
              <FileDown data-icon='inline-start' />
              下载文件
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
