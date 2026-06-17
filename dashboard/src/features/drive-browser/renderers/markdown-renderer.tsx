import type {
  DriveBrowserItemDto,
  DriveBrowserPreviewDto,
  DriveMarkdownOutlineItemDto,
} from '@synapse/shared'
import { cn } from '@/lib/utils'
import { DriveCodeRenderer } from './code-renderer'

const MARKDOWN_BODY_CLASSNAME = 'max-w-full space-y-3 text-base leading-7 [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_h1]:scroll-mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:scroll-mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:scroll-mt-6 [&_h3]:font-medium [&_h4]:scroll-mt-6 [&_h5]:scroll-mt-6 [&_h6]:scroll-mt-6 [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc'

export function DriveMarkdownRenderer({
  current,
  preview,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
}) {
  const renderedHtml = preview.html?.trim()
  if (!renderedHtml) return <DriveCodeRenderer current={current} preview={preview} />
  const outline = preview.outline ?? []

  if (outline.length === 0) {
    return (
      <div className='mx-auto min-h-0 w-full max-w-3xl px-4 py-6 md:px-6'>
        <div
          className={MARKDOWN_BODY_CLASSNAME}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
        {preview.truncated ? (
          <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
        ) : null}
      </div>
    )
  }

  return (
    <div className='mx-auto flex min-h-0 w-full max-w-6xl gap-6 px-4 py-6 md:px-6'>
      <aside className='hidden w-52 shrink-0 xl:block'>
        <nav className='sticky top-6 max-h-[calc(100vh-3rem)] overflow-auto pl-4' aria-label='目录'>
          <p className='mb-2 text-xs font-medium text-muted-foreground'>目录</p>
          <MarkdownOutlineTree items={outline} />
        </nav>
      </aside>
      <div className='min-w-0 flex-1'>
        <div className='mx-auto max-w-3xl'>
          <div
            className={MARKDOWN_BODY_CLASSNAME}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
          {preview.truncated ? (
            <div className='mt-4 border-t pt-2 text-xs text-muted-foreground'>内容已截断</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function MarkdownOutlineTree({ items }: { readonly items: readonly DriveMarkdownOutlineItemDto[] }) {
  return (
    <ul className='space-y-1'>
      {items.map((item) => (
        <MarkdownOutlineNode key={item.id} item={item} />
      ))}
    </ul>
  )
}

function MarkdownOutlineNode({ item }: { readonly item: DriveMarkdownOutlineItemDto }) {
  return (
    <li>
      <a
        className={cn(
          'block truncate rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          outlineDepthClassName(item.depth)
        )}
        href={`#${item.id}`}
      >
        {item.text}
      </a>
      {item.children.length > 0 ? <MarkdownOutlineTree items={item.children} /> : null}
    </li>
  )
}

function outlineDepthClassName(depth: number): string {
  if (depth <= 1) return 'pl-0'
  if (depth === 2) return 'pl-3'
  if (depth === 3) return 'pl-6'
  if (depth === 4) return 'pl-9'
  if (depth === 5) return 'pl-12'
  return 'pl-14'
}
