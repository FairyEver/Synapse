import Editor from '@monaco-editor/react'
import type { DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { getCodeEditorLanguage } from '@/lib/code-editor-language'

export function DriveCodeRenderer({
  current,
  preview,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
}) {
  const language = getCodeEditorLanguage(current.name)

  return (
    <div
      data-drive-code-renderer='true'
      data-drive-code-language={language}
      className='flex h-full min-h-0 w-full flex-col overflow-hidden'
    >
      <div className='min-h-0 flex-1'>
        <Editor
          height='100%'
          language={language}
          value={preview.text ?? ''}
          options={{
            minimap: { enabled: false },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            fontSize: 13,
            tabSize: 2,
            readOnly: true,
            domReadOnly: true,
          }}
        />
      </div>
      {preview.truncated ? (
        <div className='border-t px-3 py-2 text-xs text-muted-foreground'>内容已截断</div>
      ) : null}
    </div>
  )
}
