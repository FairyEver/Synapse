import {
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor"
import "@mdxeditor/editor/style.css"
import { useMemo } from "react"

import { createDriveMarkdownImageUploader, type DriveMarkdownImageUploadConfirmation } from "./drive-markdown-image-uploader"

export type DriveMdxEditorProps = {
  readonly markdown: string
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onUploadingChange: (uploading: boolean) => void
  readonly confirmPublicImageUpload?: DriveMarkdownImageUploadConfirmation
}

export function DriveMdxEditor({
  markdown,
  onDirtyChange,
  onUploadingChange,
  confirmPublicImageUpload,
}: DriveMdxEditorProps) {
  const uploader = useMemo(() => createDriveMarkdownImageUploader(undefined, confirmPublicImageUpload), [confirmPublicImageUpload])
  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({
      imageUploadHandler: async (file) => {
        onUploadingChange(true)
        try {
          return await uploader.upload(file)
        } finally {
          onUploadingChange(false)
        }
      },
    }),
    tablePlugin(),
    thematicBreakPlugin(),
    codeBlockPlugin(),
    codeMirrorPlugin(),
    diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: "" }),
    markdownShortcutPlugin(),
    toolbarPlugin({ toolbarContents: () => null }),
  ], [onUploadingChange, uploader])

  return (
    <MDXEditor
      markdown={markdown}
      plugins={plugins}
      onChange={() => onDirtyChange(true)}
      contentEditableClassName="prose max-w-none"
    />
  )
}
