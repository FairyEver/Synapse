import Editor from '@monaco-editor/react'
import type { DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { getCodeEditorLanguage } from '@/lib/code-editor-language'
import { cn } from '@/lib/utils'

export function DriveCodeRenderer({
  current,
  preview,
  body = false,
}: {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly body?: boolean
}) {
  const language = getCodeEditorLanguage(current.name)

  return (
    <div
      data-drive-code-renderer='true'
      data-drive-code-language={language}
      className={cn('flex min-h-0 w-full flex-col overflow-hidden', body ? 'h-svh' : 'h-full')}
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
