import { cn } from '@/lib/utils'
import { DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME } from './drive-hierarchical-list-markers'

export const MARKDOWN_BODY_CLASSNAME = cn(
  'markdown-body @container max-w-full [&_ul]:list-disc [&_ol]:list-decimal! [&_ul]:pl-6 [&_ol]:pl-6 [&_[data-drive-markdown-table-scroll="true"]]:max-w-full [&_[data-drive-markdown-table-scroll="true"]]:overflow-x-auto [&_table]:w-max [&_table]:min-w-full [&_table]:max-w-none [&_td:first-child]:whitespace-nowrap [&_th:first-child]:whitespace-nowrap [&_td:not(:first-child)]:min-w-56 [&_th:not(:first-child)]:min-w-56 [&_h4]:text-base! [&_h4]:leading-tight! [&_h5]:text-base! [&_h5]:leading-tight! [&_h6]:text-base! [&_h6]:leading-tight! [&_img]:mx-auto [&_img]:block [&_img]:h-auto [&_img]:max-h-[min(100cqi,var(--container-3xl))] [&_img]:max-w-full [&_img]:object-contain [&_img[role="button"]]:cursor-zoom-in [&_img[role="button"]]:focus-visible:outline-none [&_img[role="button"]]:focus-visible:ring-2 [&_img[role="button"]]:focus-visible:ring-ring [&_img[role="button"]]:focus-visible:ring-offset-2',
  DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME,
)

export const MARKDOWN_READER_BODY_CLASSNAME = cn(
  MARKDOWN_BODY_CLASSNAME,
  '[&_table]:min-w-0 [&_table]:mx-auto',
)

// Keep the body/annotation coordinate space full-width; only ordinary blocks use the reading measure.
// Mermaid replaces its source <pre> asynchronously, so match the resulting figure without rewriting HTML.
export const MARKDOWN_READING_BODY_CLASSNAME = cn(
  '[&>:not([data-drive-markdown-table-scroll]):not([data-drive-mermaid-diagram])]:mx-auto!',
  '[&>:not([data-drive-markdown-table-scroll]):not([data-drive-mermaid-diagram])]:max-w-3xl',
)
