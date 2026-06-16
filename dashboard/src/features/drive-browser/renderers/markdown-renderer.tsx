import type { DriveBrowserPreviewDto } from '@synapse/shared'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DriveSourceRenderer } from './source-renderer'

export function DriveMarkdownRenderer({ preview }: { readonly preview: DriveBrowserPreviewDto }) {
  const renderedHtml = preview.html?.trim()
  if (!renderedHtml) return <DriveSourceRenderer preview={preview} />

  return (
    <Tabs defaultValue='rendered' className='min-h-0 gap-0 py-6'>
      <div data-renderer-toolbar='markdown' className='flex justify-end pb-4'>
        <TabsList>
          <TabsTrigger type='button' value='rendered'>预览</TabsTrigger>
          <TabsTrigger type='button' value='source'>源码</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value='rendered' className='min-h-0'>
        <div
          className='space-y-3 text-base leading-7 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-medium [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc'
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {preview.truncated ? (
          <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
        ) : null}
      </TabsContent>
      <TabsContent value='source' className='min-h-0'>
        <DriveSourceRenderer preview={preview} className='py-0' />
      </TabsContent>
    </Tabs>
  )
}
