import '@/styles/globals.css'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { FilePreviewLayout } from '@/features/file-browser/preview/file-preview-layout'
import { FileRendererShell } from '@/features/file-browser/renderers/renderer-shell'
import { useRegisterFileRendererToolbarItems } from '@/features/file-browser/renderers/renderer-toolbar-context'
import { DrivePreviewHeader } from './drive-preview-header'
import { DrivePreviewFloatingMenu } from './drive-preview-floating-menu'

afterEach(() => vi.restoreAllMocks())

describe.each([
  { mode: 'regular', widthClass: 'w-[1280px]' },
  { mode: 'compact', widthClass: 'w-[390px]' },
])('expanded $mode document menu', ({ mode, widthClass }) => {
  it('dismisses the shared file renderer toolbar menu', async () => {
    await page.viewport(mode === 'compact' ? 390 : 1440, 900)
    const screen = await render(
      <div className={widthClass}>
        <FileRendererShell title='文件预览'><FileToolbarFixture /></FileRendererShell>
        <p className='mt-96' data-testid='outside'>文件正文</p>
      </div>
    )
    try {
      await expect.poll(() => document.querySelector('[data-file-preview-header]')?.getAttribute('data-file-preview-header')).toBe(mode)
      const trigger = document.querySelector<HTMLButtonElement>('button')!
      await userEvent.click(trigger)
      await waitForElement('[role="menu"]')
      await userEvent.click(trigger, { force: true })
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
      await userEvent.click(trigger)
      await waitForElement('[role="menu"]')
      await userEvent.click(document.querySelector<HTMLElement>('[data-testid="outside"]')!, { force: true })
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
    } finally {
      await screen.unmount()
      await page.viewport(1440, 900)
    }
  })

  it('dismisses by repeated click, outside click and Escape without stacking menus', async () => {
    await page.viewport(mode === 'compact' ? 390 : 1440, 900)
    const screen = await render(
      <div className={widthClass}>
        <FilePreviewLayout>
          <DrivePreviewHeader
            snapshot={snapshot()}
            rendererItems={[{
              id: 'width', kind: 'menu', label: '宽度', compactPlacement: 'primary',
              selectedItemId: 'normal',
              items: [{ id: 'normal', label: '标准', onSelect: vi.fn() }],
            }]}
            rendererOptions={[]}
            selectedRendererId='markdown'
            onRendererChange={vi.fn()}
            onOpenVersions={vi.fn()}
          />
        </FilePreviewLayout>
        <p className='mt-96' data-testid='outside'>文档正文</p>
      </div>
    )
    try {
      await expect.poll(() => document.querySelector('[data-file-preview-header]')?.getAttribute('data-file-preview-header')).toBe(mode)
      const labels = mode === 'compact' ? ['宽度', '更多'] : ['宽度', '打开方式', '更多']
      for (const label of labels) {
        const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === label)!
        await userEvent.click(trigger)
        await waitForElement('[role="menu"]')
        await userEvent.click(trigger, { force: true })
        await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
        expect(trigger.getAttribute('aria-expanded')).toBe('false')

        await userEvent.click(trigger)
        await waitForElement('[role="menu"]')
        await userEvent.click(document.querySelector<HTMLElement>('[data-testid="outside"]')!, { force: true })
        await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()

        trigger.focus()
        await userEvent.keyboard('{Enter}')
        const menu = await waitForElement('[role="menu"]')
        const popover = menu.closest<HTMLElement>('[data-slot="dropdown-popover"]')!
        await expect.poll(() => popover.hasAttribute('data-entering')).toBe(false)
        const rect = popover.getBoundingClientRect()
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
        await page.screenshot({ path: `__screenshots__/drive-menu-${mode}-${label}.png` })
        await userEvent.keyboard('{Escape}')
        await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
        await expect.poll(() => document.activeElement).toBe(trigger)
      }

      const triggers = labels.map((label) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === label)!)
      await userEvent.click(triggers[0])
      await waitForElement('[role="menu"]')
      // The native menu underlay consumes the first click on another trigger.
      await userEvent.click(triggers[1], { force: true })
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
      await userEvent.click(triggers[1])
      await expect.poll(() => document.querySelectorAll('[role="menu"]')).toHaveLength(1)

    } finally {
      await screen.unmount()
      await page.viewport(1440, 900)
    }
  })

  it('dismisses the HTML floating file menu and can reopen it', async () => {
    await page.viewport(mode === 'compact' ? 390 : 1440, 900)
    const screen = await render(
      <>
        <DrivePreviewFloatingMenu
          snapshot={snapshot()}
          rendererItems={[]}
          rendererOptions={[]}
          selectedRendererId='iframe'
          onRendererChange={vi.fn()}
          onOpenVersions={vi.fn()}
        />
        <p className='mt-96' data-testid='outside'>网页正文</p>
      </>
    )
    try {
      const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="文件操作"]')!
      await userEvent.click(trigger)
      await waitForElement('[role="menu"]')
      await userEvent.click(trigger, { force: true })
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
      await userEvent.click(trigger)
      await waitForElement('[role="menu"]')
      await userEvent.click(document.querySelector<HTMLElement>('[data-testid="outside"]')!, { force: true })
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
      trigger.focus()
      await userEvent.keyboard('{Enter}')
      await waitForElement('[role="menu"]')
      await userEvent.keyboard('{Escape}')
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
    } finally {
      await screen.unmount()
      await page.viewport(1440, 900)
    }
  })

  it('keeps menu icons proportional, groups content and retains menu interactions', async () => {
    const onOpenVersions = vi.fn()
    const onRendererChange = vi.fn()
    const screen = await render(
      <div className={widthClass}>
        <FilePreviewLayout>
          <DrivePreviewHeader
            snapshot={snapshot()}
            rendererItems={[]}
            rendererOptions={[]}
            selectedRendererId='markdown'
            onRendererChange={onRendererChange}
            onOpenVersions={onOpenVersions}
            pdfExport={{ exporting: false, disabledReason: null, onExport: vi.fn() }}
          />
        </FilePreviewLayout>
      </div>
    )
    try {
      await expect.poll(() => document.querySelector('[data-file-preview-header]')?.getAttribute('data-file-preview-header')).toBe(mode)
      const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')!
      await userEvent.click(trigger)
      const menu = await waitForElement('[role="menu"]')
      const popover = menu.closest<HTMLElement>('[data-slot="dropdown-popover"]')!
      await Promise.all(popover.getAnimations().map((animation) => animation.finished))
      await expect.poll(() => popover.hasAttribute('data-entering')).toBe(false)
      for (const item of menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
        const icon = item.querySelector('svg')!
        await expect.poll(() => icon.getBoundingClientRect().width).toBeCloseTo(16, 1)
        expect(icon.getBoundingClientRect().height).toBeCloseTo(16, 1)
        expect(item.querySelector('[data-slot="label"]')).not.toBeNull()
        expect(item.getBoundingClientRect().height).toBeCloseTo(36, 1)
      }
      await userEvent.hover(menuItem('导出为 PDF'))
      await expect.poll(() => menuItem('导出为 PDF').getAttribute('data-hovered')).toBe('true')
      if (mode === 'compact') {
        const metadata = document.querySelector('[data-drive-preview-file-metadata]')!
        const title = metadata.querySelector<HTMLElement>('[data-drive-preview-menu-file-name]')!
        const detail = metadata.querySelector<HTMLElement>('[data-slot="description"]')!
        expect(title.getBoundingClientRect().left).toBe(detail.getBoundingClientRect().left)
        expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
        expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
        const rendererGroup = menu.querySelector('[role="group"][aria-label="打开方式"]')!
        expect(rendererGroup).not.toBeNull()
        expect(rendererGroup.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
        expect(rendererGroup.querySelector('[aria-checked="true"]')?.textContent).toBe('预览')
        const commandLabel = menu.querySelector('[role="menuitem"] [data-slot="label"]')!
        for (const label of rendererGroup.querySelectorAll('[data-slot="label"]')) {
          expect(Math.abs(label.getBoundingClientRect().left - commandLabel.getBoundingClientRect().left)).toBeLessThan(1)
        }
        await userEvent.click(menuItem('代码'))
        expect(onRendererChange).toHaveBeenCalledExactlyOnceWith('code')
        await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
        await userEvent.click(trigger)
        await waitForElement('[role="menu"]')
      }
      await userEvent.click(menuItem('历史版本'))
      expect(onOpenVersions).toHaveBeenCalledExactlyOnceWith('file')
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
      trigger.focus()
      await userEvent.keyboard('{Enter}')
      await waitForElement('[role="menu"]')
      await userEvent.keyboard('{Escape}')
      await expect.poll(() => document.activeElement).toBe(trigger)
      if (mode === 'regular') {
        const rendererTrigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '打开方式')!
        rendererTrigger.focus()
        await userEvent.keyboard('{Enter}')
        await waitForElement('[role="menu"]')
        await userEvent.keyboard('{End}{Enter}')
        expect(onRendererChange).toHaveBeenCalledExactlyOnceWith('code')
      }
    } finally {
      await screen.unmount()
    }
  })

  it('skips an unavailable renderer during keyboard navigation', async () => {
    const data = snapshot()
    const onRendererChange = vi.fn()
    const screen = await render(
      <div className={widthClass}>
        <FilePreviewLayout>
          <DrivePreviewHeader
            snapshot={{ ...data, preview: { ...data.preview!, truncated: true } }}
            rendererItems={[]}
            rendererOptions={[]}
            selectedRendererId='markdown'
            onRendererChange={onRendererChange}
            onOpenVersions={vi.fn()}
          />
        </FilePreviewLayout>
      </div>
    )
    try {
      await expect.poll(() => document.querySelector('[data-file-preview-header]')?.getAttribute('data-file-preview-header')).toBe(mode)
      const trigger = mode === 'compact'
        ? document.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')!
        : [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '打开方式')!
      await userEvent.click(trigger)
      const menu = await waitForElement('[role="menu"]')
      const disabled = menu.querySelector('[role="menuitemradio"][aria-disabled="true"]')!
      expect(disabled.querySelector('[data-slot="description"]')?.textContent).toBe('超过富文本限制')
      menuItem('预览').focus()
      await userEvent.keyboard('{ArrowDown}')
      expect(document.activeElement?.textContent).toBe('代码')
      await userEvent.keyboard('{Enter}')
      expect(onRendererChange).toHaveBeenCalledExactlyOnceWith('code')
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull()
    } finally {
      await screen.unmount()
    }
  })
})

function menuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].find((element) => element.textContent?.trim() === label)
  if (!item) throw new Error(`Missing menu action: ${label}`)
  return item
}

const FILE_TOOLBAR_ITEMS = [{
  id: 'view', kind: 'menu' as const, label: '视图',
  items: [{ id: 'default', label: '默认', onSelect: () => undefined }],
}]

function FileToolbarFixture() {
  useRegisterFileRendererToolbarItems('fixture', FILE_TOOLBAR_ITEMS)
  return null
}

async function waitForElement(selector: string) {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull()
  return document.querySelector<HTMLElement>(selector)!
}

function snapshot(): DriveBrowserSnapshotDto {
  return {
    context: 'owner', surface: 'standalone',
    current: {
      id: 'file', name: '工作流循环机制调研与头脑风暴及补充说明与审阅记录.md', type: 'file',
      size: '7373', mimeType: 'text/markdown', previewKind: 'markdown',
      updatedAt: '2026-07-01T00:00:00Z', browserUrl: '/drive/items/file', downloadUrl: '/drive/items/file/download',
    },
    breadcrumbs: [], children: [], canDownload: true, canZip: false,
    preview: { kind: 'markdown', html: '<h1>工作流调研</h1>', text: '# 工作流调研', outline: [], imageUrl: null, visitUrl: null, truncated: false },
    edit: { canEdit: true, editorKind: 'text', currentVersionId: 'version', reason: null },
    annotation: null,
  }
}
