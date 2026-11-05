import {
  commonMarkTextCompatibilityPlugin,
  commonMarkToMarkdownOptions,
} from './mdxeditor-commonmark-compatibility-plugin'
import { orderedListStartPlugin } from './mdxeditor-ordered-list-start-plugin'
import { tableCellLineBreakPlugin } from './mdxeditor-table-cell-line-break-plugin'
import { trailingImageParagraphPlugin } from './mdxeditor-trailing-image-plugin'

export const commonMarkEditorProps = {
  suppressHtmlProcessing: true,
  toMarkdownOptions: commonMarkToMarkdownOptions,
} as const

export function commonMarkEditorPlugins() {
  return [
    commonMarkTextCompatibilityPlugin(),
    orderedListStartPlugin(),
    tableCellLineBreakPlugin(),
    trailingImageParagraphPlugin(),
  ]
}
