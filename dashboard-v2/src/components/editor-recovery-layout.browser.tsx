import '@/styles/globals.css'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ApiError } from '@/lib/api'
import { DriveDocumentEditorRecoveryDialogs } from '@/features/drive-browser/renderers/drive-document-editor-lifecycle'
import { FileBrowserCodeRenderer } from '@/features/file-browser/renderers/code-renderer'
import { FileRendererToolbarProvider, useFileRendererToolbar } from '@/features/file-browser/renderers/renderer-toolbar-context'
import { FilePreviewToolbarItemView } from '@/features/file-browser/preview/file-preview-toolbar'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (value: string) => void }) =>
    <textarea aria-label='代码编辑器' value={value} onChange={(event) => onChange?.(event.target.value)} />,
}))

function Toolbar() {
  return <>{useFileRendererToolbar().items.map((item) => <FilePreviewToolbarItemView key={item.id} item={item} />)}</>
}

async function checkActions(width: number) {
  const dialog = page.getByRole('alertdialog').element()
  const backdrop = dialog.closest('[data-slot="alert-dialog-backdrop"]')!
  await vi.waitFor(() => expect(backdrop.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')).toBe(false))
  const bounds = dialog.getBoundingClientRect()
  const buttons = dialog.querySelectorAll('[data-slot="alert-dialog-footer"] button')
  expect(buttons.length).toBe(3)
  for (const button of buttons) {
    const rect = button.getBoundingClientRect()
    expect.soft(rect.left).toBeGreaterThanOrEqual(bounds.left + 20)
    expect.soft(rect.right).toBeLessThanOrEqual(bounds.right - 20)
    expect.soft(rect.bottom).toBeLessThanOrEqual(800)
  }
  expect.soft(bounds.right).toBeLessThanOrEqual(width)
}

for (const width of [320, 390, 1280]) {
  for (const conflict of [false, true]) {
    it(`文档恢复 ${conflict ? '冲突' : '重载'} 的三个操作完整可见 ${width}px`, async () => {
      await page.viewport(width, 800)
      const reload = vi.fn()
      await render(<DriveDocumentEditorRecoveryDialogs conflictOpen={conflict} reloadConfirmOpen={!conflict}
        fileName='draft.md' localValue='local draft' onConflictOpenChange={vi.fn()} onReloadConfirmOpenChange={vi.fn()} onReload={reload} />)
      await checkActions(width)
      expect(reload).not.toHaveBeenCalled()
    })

    it(`文件编辑恢复 ${conflict ? '冲突' : '重载'} 的三个操作完整可见 ${width}px`, async () => {
      await page.viewport(width, 800)
      await render(<FileRendererToolbarProvider><Toolbar /><FileBrowserCodeRenderer path='file.md' text='original' baseVersionId='v1'
        editContext={{ reloading: false, savingText: false, reload: vi.fn(async () => ({ text: 'remote', baseVersionId: 'v2' })),
          saveText: vi.fn(async () => { throw new ApiError('文件已有新内容', 409) }) }} /></FileRendererToolbarProvider>)
      await page.getByRole('textbox', { name: '代码编辑器' }).fill('local draft')
      await page.getByRole('button', { name: conflict ? '保存' : '重新加载', exact: true }).click()
      await expect.element(page.getByRole('alertdialog')).toBeVisible()
      await checkActions(width)
      await page.getByRole('button', { name: '取消', exact: true }).click()
      expect((page.getByRole('textbox', { name: '代码编辑器' }).element() as HTMLTextAreaElement).value).toBe('local draft')
    })
  }
}
