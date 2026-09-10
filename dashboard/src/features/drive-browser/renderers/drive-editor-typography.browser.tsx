import '@/styles/index.css'
import '@milkdown/crepe/theme/common/style.css'
import '@mdxeditor/editor/style.css'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DriveBrowserEditDto, DriveBrowserItemDto, DriveBrowserPreviewDto } from '@synapse/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'
import { DriveMilkdownRenderer } from './milkdown-renderer'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'

let host: HTMLElement | null = null
let lateVendorStyle: HTMLStyleElement | null = null

afterEach(() => {
  host?.remove()
  lateVendorStyle?.remove()
  host = null
  lateVendorStyle = null
})

describe('drive editor typography in Chromium', () => {
  it('keeps semantic typography identical across real Milkdown and MDXEditor mounts', async () => {
    const screen = await render(browserEditorPair())
    try {
      const roots = await waitForRealEditorRoots()

      for (const selector of REAL_COMPARABLE_SELECTORS) {
        expectComparableStyles(roots.milkdown, roots.mdxeditor, selector)
      }

      expect(getComputedStyle(roots.milkdown.querySelector('h1')!).fontSize).toBe('32px')
      expect(getComputedStyle(roots.milkdown.querySelector('h6')!).fontSize).toBe('16px')
      expect(getComputedStyle(roots.milkdown.querySelector('p')!).lineHeight).toBe('24px')
      expect(getComputedStyle(roots.milkdown.querySelector('code')!).color).toBe(getComputedStyle(roots.mdxeditor).color)
    } finally {
      await screen.unmount()
    }
  })

  it('wins over editor styles that are injected after the project stylesheet', () => {
    const roots = renderSyntheticEditorFixtures()
    const before = snapshotStyles(roots)
    lateVendorStyle = document.createElement('style')
    lateVendorStyle.textContent = `
      .milkdown .ProseMirror h1,
      .drive-mdxeditor-content h1 { color: var(--destructive); font-size: 2.625rem; font-weight: 400; }
      .milkdown .ProseMirror code,
      .drive-mdxeditor-content code { color: var(--destructive); font-size: 2rem; }
    `
    document.head.append(lateVendorStyle)

    expect(snapshotStyles(roots)).toEqual(before)
  })

  it('keeps code block placeholders aligned with the initialized CodeMirror shell', () => {
    const roots = renderSyntheticEditorFixtures()
    const placeholder = roots.milkdown.querySelector<HTMLElement>('.milkdown-code-block-placeholder code')!
    const milkdownScroller = roots.milkdown.querySelector<HTMLElement>('.cm-scroller')!
    const mdxeditorEditor = roots.mdxeditor.querySelector<HTMLElement>('.cm-editor')!
    const mutedReference = roots.milkdown.closest<HTMLElement>('.milkdown')?.querySelector<HTMLElement>('[data-muted-reference]')
    if (!mutedReference) throw new Error('Missing muted color reference')
    const placeholderStyles = getComputedStyle(placeholder)

    expect(placeholderStyles.display).toBe('block')
    expect(placeholderStyles.fontFamily).toBe(getComputedStyle(milkdownScroller).fontFamily)
    expect(placeholderStyles.fontSize).toBe(getComputedStyle(milkdownScroller).fontSize)
    expect(placeholderStyles.lineHeight).toBe(getComputedStyle(milkdownScroller).lineHeight)
    expect(placeholderStyles.color).toBe(getComputedStyle(mutedReference).color)
    expect(getComputedStyle(roots.milkdown.querySelector('.cm-editor')!).backgroundColor).toBe(getComputedStyle(mdxeditorEditor).backgroundColor)
  })

  it('normalizes list rhythm while preserving each editor marker implementation', () => {
    const roots = renderSyntheticEditorFixtures()
    const milkdownList = roots.milkdown.querySelector<HTMLElement>('ul')!
    const mdxeditorList = roots.mdxeditor.querySelector<HTMLElement>('ul')!
    const milkdownLabel = roots.milkdown.querySelector<HTMLElement>('.label-wrapper')!

    expect(getComputedStyle(milkdownList).marginBottom).toBe(getComputedStyle(mdxeditorList).marginBottom)
    expect(getComputedStyle(milkdownList).paddingInlineStart).toBe('0px')
    expect(getComputedStyle(milkdownLabel).width).toBe(getComputedStyle(mdxeditorList).paddingInlineStart)
    expect(getComputedStyle(roots.milkdown.querySelector('.children p')!).marginBottom).toBe('0px')
  })

  it('does not apply document-cell styling to MDXEditor table controls', () => {
    const { mdxeditor } = renderSyntheticEditorFixtures()
    const contentCell = mdxeditor.querySelector<HTMLElement>('td:not([data-tool-cell])')!
    const toolCell = mdxeditor.querySelector<HTMLElement>('td[data-tool-cell]')!

    expect(getComputedStyle(contentCell).paddingInlineStart).toBe('12px')
    expect(getComputedStyle(toolCell).paddingInlineStart).not.toBe('12px')
  })

  it('restores themed keyboard focus after the Crepe reset without outlining the editor surface', async () => {
    const { milkdown } = renderSyntheticEditorFixtures()
    const shell = milkdown.closest<HTMLElement>('.milkdown')!
    const controls = [
      shell.querySelector<HTMLElement>('button')!,
      shell.querySelector<HTMLElement>('input[aria-label="Edit link"]')!,
      shell.querySelector<HTMLElement>('.language-list-item')!,
    ]

    for (const control of controls) {
      await userEvent.tab()
      expect(document.activeElement).toBe(control)
      expect(control.matches(':focus-visible')).toBe(true)
      expectFocusRing(control, shell)
    }

    const searchInput = shell.querySelector<HTMLInputElement>('.search-input')!
    const searchBox = searchInput.closest<HTMLElement>('.search-box')!
    await userEvent.tab()
    expect(document.activeElement).toBe(searchInput)
    expect(getComputedStyle(searchInput).outlineStyle).toBe('none')
    expect(getComputedStyle(searchBox).outlineStyle).toBe('solid')
    expect(getComputedStyle(searchBox).outlineWidth).toBe('2px')

    await userEvent.tab()
    expect(document.activeElement).toBe(milkdown)
    expect(milkdown.matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(milkdown).outlineStyle).toBe('none')
  })
})

describe('DriveMilkdownRenderer in Chromium', () => {
  it('preserves bare URI and email source text when a user saves another rich-text change', async () => {
    const source = [
      '# Notes',
      '',
      'See https://example.com now',
      'Email test@example.com',
      'Keep <https://explicit.example/path>',
      '',
      '`https://inline.example test@example.com`',
    ].join('\n')
    const context = browserEditContext()
    const screen = await render(browserRenderer({
      preview: browserPreview(source),
      editContext: context,
    }))
    const editor = await waitForRichEditor()

    await replaceBlockText(editor, 'Notes', 'Notes updated')
    await saveWithKeyboard(context)

    const submitted = context.saveText.mock.calls[0]?.[0].text
    expect(submitted).toContain('# Notes updated')
    expect(submitted).toContain('See https://example.com now')
    expect(submitted).toContain('Email test@example.com')
    expect(submitted).toContain('Keep <https://explicit.example/path>')
    expect(submitted).toContain('`https://inline.example test@example.com`')
    await screen.unmount()
  })

  it('saves edits against the latest externally supplied Markdown version', async () => {
    const context = browserEditContext()
    const queryClient = new QueryClient()
    const screen = await render(browserRenderer({
      preview: browserPreview('# First'),
      editContext: context,
    }, queryClient))
    await waitForRichEditor()

    await screen.rerender(browserRenderer({
      preview: browserPreview('# Latest'),
      edit: browserEditable('version-3'),
      editContext: context,
    }, queryClient))
    await expect.poll(() => document.querySelector<HTMLElement>('.drive-milkdown-editor .ProseMirror')?.textContent).toContain('Latest')
    const editor = await waitForRichEditor()
    expect(editor.textContent).not.toContain('First')

    await replaceBlockText(editor, 'Latest', 'Latest updated')
    await saveWithKeyboard(context)

    expect(context.saveText).toHaveBeenCalledOnce()
    expect(context.saveText.mock.calls[0]?.[0].baseVersionId).toBe('version-3')
    expect(context.saveText.mock.calls[0]?.[0].text).toContain('# Latest updated')
    expect(context.saveText.mock.calls[0]?.[0].text).not.toContain('First')
    await screen.unmount()
  })

  it('shows hierarchical ordered markers without adding them to saved Markdown', async () => {
    const source = '2. Parent\n\n   4. Child\n   5. Next'
    const context = browserEditContext()
    const screen = await render(browserRenderer({
      preview: browserPreview(source),
      editContext: context,
    }))
    const editor = await waitForRichEditor()

    await expect.poll(() => Array.from(editor.querySelectorAll('li'), (item) => item.getAttribute('data-drive-list-marker'))).toEqual([
      '2.',
      '2.4',
      '2.5',
    ])
    expect(Array.from(editor.querySelectorAll('.label.ordered'), (label) => label.textContent)).toEqual([
      '2.',
      '2.4',
      '2.5',
    ])

    await replaceBlockText(editor, 'Next', 'Next updated')
    await saveWithKeyboard(context)

    const saved = context.saveText.mock.calls[0]?.[0].text
    expect(saved).toContain('2. Parent')
    expect(saved).toMatch(/\n\s+4\. Child\n\s+5\. Next updated/u)
    expect(saved).not.toContain('data-drive-list-marker')
    expect(saved).not.toContain('2.4 Child')
    await screen.unmount()
  })
})

function renderSyntheticEditorFixtures(): { readonly milkdown: HTMLElement; readonly mdxeditor: HTMLElement } {
  host = document.createElement('main')
  host.innerHTML = `
    <section class="drive-milkdown-editor">
      <div class="milkdown">
        <button type="button">Format</button>
        <input aria-label="Edit link">
        <div class="language-list-item" tabindex="0">JavaScript</div>
        <div class="milkdown-code-block">
          <div class="search-box"><input class="search-input" aria-label="Search languages"></div>
        </div>
        <span class="text-muted-foreground" data-muted-reference></span>
        <div class="ProseMirror" contenteditable="true" tabindex="0">${semanticContent('milkdown')}</div>
      </div>
    </section>
    <section class="drive-mdxeditor-content">${semanticContent('mdxeditor')}</section>
  `
  document.body.append(host)
  return {
    milkdown: host.querySelector('.drive-milkdown-editor .ProseMirror')!,
    mdxeditor: host.querySelector('.drive-mdxeditor-content')!,
  }
}

function browserEditorPair() {
  const current = browserCurrent()
  const preview = browserPreview(REAL_EDITOR_MARKDOWN)
  return (
    <QueryClientProvider client={new QueryClient()}>
      <DriveRendererToolbarProvider>
        <div className='grid h-screen grid-cols-2'>
          <section data-browser-editor='milkdown' className='min-h-0 overflow-hidden'>
            <DriveMilkdownRenderer
              current={current}
              preview={preview}
              edit={browserEditable()}
              editContext={browserEditContext()}
            />
          </section>
          <section data-browser-editor='mdxeditor' className='min-h-0 overflow-hidden'>
            <DriveMDXeditorRenderer
              current={current}
              preview={preview}
              edit={browserEditable()}
              editContext={browserEditContext()}
            />
          </section>
        </div>
      </DriveRendererToolbarProvider>
    </QueryClientProvider>
  )
}

async function waitForRealEditorRoots(): Promise<{ readonly milkdown: HTMLElement; readonly mdxeditor: HTMLElement }> {
  await expect.poll(() => {
    const milkdown = document.querySelector<HTMLElement>('[data-browser-editor="milkdown"] .ProseMirror')
    const mdxeditor = document.querySelector<HTMLElement>('[data-browser-editor="mdxeditor"] .drive-mdxeditor-content')
    return Boolean(milkdown && mdxeditor && REAL_COMPARABLE_SELECTORS.every((selector) => (
      milkdown.querySelector(selector) && mdxeditor.querySelector(selector)
    )))
  }).toBe(true)
  return {
    milkdown: document.querySelector<HTMLElement>('[data-browser-editor="milkdown"] .ProseMirror')!,
    mdxeditor: document.querySelector<HTMLElement>('[data-browser-editor="mdxeditor"] .drive-mdxeditor-content')!,
  }
}

const REAL_COMPARABLE_SELECTORS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  '.cm-editor',
  '.cm-scroller',
  '.cm-content',
  'table',
  'th',
  'td',
] as const

const REAL_EDITOR_MARKDOWN = [
  '# Heading 1',
  '## Heading 2',
  '### Heading 3',
  '#### Heading 4',
  '##### Heading 5',
  '###### Heading 6',
  '',
  'Paragraph with `inline code`.',
  '',
  '- Bullet',
  '',
  '1. Ordered',
  '',
  '> Quote',
  '',
  '```ts',
  'const value = 1',
  '```',
  '',
  '| Heading | Value |',
  '| --- | --- |',
  '| Cell | End |',
].join('\n')

function semanticContent(editor: 'milkdown' | 'mdxeditor'): string {
  const codeBlock = editor === 'milkdown'
    ? '<div class="milkdown-code-block"><pre class="milkdown-code-block-placeholder"><code>const value = 1</code></pre><div><div class="cm-editor"><div class="cm-scroller"><div class="cm-content">const value = 1</div></div></div></div></div>'
    : '<div><div class="code-toolbar"></div><div><div class="cm-editor"><div class="cm-scroller"><div class="cm-content">const value = 1</div></div></div></div></div>'

  return `
    <h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3>
    <h4>Heading 4</h4><h5>Heading 5</h5><h6>Heading 6</h6>
    <p>Paragraph with <code>inline code</code>.</p>
    ${editor === 'milkdown'
      ? '<ul><milkdown-list-item-block class="milkdown-list-item-block"><li class="list-item"><div class="label-wrapper">•</div><div class="children"><p>Bullet</p></div></li></milkdown-list-item-block></ul><ol><milkdown-list-item-block class="milkdown-list-item-block"><li class="list-item"><div class="label-wrapper">1.</div><div class="children"><p>Ordered</p></div></li></milkdown-list-item-block></ol>'
      : '<ul><li>Bullet</li></ul><ol><li>Ordered</li></ol>'}
    <blockquote><p>Quote</p></blockquote>
    <pre><code>plain code block</code></pre>
    ${codeBlock}
    ${editor === 'milkdown' ? '<div class="milkdown-table-block">' : ''}<table><tbody><tr><th>Heading</th><td>Value</td>${editor === 'mdxeditor' ? '<td data-tool-cell="true">Tools</td>' : ''}</tr></tbody></table>${editor === 'milkdown' ? '</div>' : ''}
  `
}

function expectComparableStyles(milkdown: HTMLElement, mdxeditor: HTMLElement, selector: string): void {
  const milkdownStyles = getComputedStyle(milkdown.querySelector(selector)!)
  const mdxeditorStyles = getComputedStyle(mdxeditor.querySelector(selector)!)
  for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'margin-top', 'margin-bottom', 'padding-left', 'padding-right', 'color', 'background-color', 'border-left-width']) {
    expect(milkdownStyles.getPropertyValue(property), `${selector} ${property}`).toBe(mdxeditorStyles.getPropertyValue(property))
  }
}

function snapshotStyles(roots: { readonly milkdown: HTMLElement; readonly mdxeditor: HTMLElement }): readonly string[] {
  return [roots.milkdown, roots.mdxeditor].flatMap((root) => ['h1', 'code'].flatMap((selector) => {
    const styles = getComputedStyle(root.querySelector(selector)!)
    return [styles.color, styles.fontSize, styles.fontWeight]
  }))
}

function expectFocusRing(control: HTMLElement, shell: HTMLElement): void {
  const styles = getComputedStyle(control)
  expect(styles.outlineStyle).toBe('solid')
  expect(styles.outlineWidth).toBe('2px')
  expect(styles.outlineColor).toBe(getComputedStyle(shell).getPropertyValue('--ring').trim())
  expect(styles.outlineOffset).toBe('2px')
}

type BrowserRendererOptions = {
  readonly current?: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext: NonNullable<ComponentProps<typeof DriveMilkdownRenderer>['editContext']>
}

function browserRenderer({
  current = browserCurrent(),
  preview,
  edit = browserEditable(),
  editContext,
}: BrowserRendererOptions, queryClient = new QueryClient()) {
  return (
    <QueryClientProvider client={queryClient}>
      <DriveRendererToolbarProvider>
        <BrowserUnsavedState />
        <DriveMilkdownRenderer
          current={current}
          preview={preview}
          edit={edit}
          editContext={editContext}
        />
      </DriveRendererToolbarProvider>
    </QueryClientProvider>
  )
}

function BrowserUnsavedState() {
  const { hasUnsavedChanges } = useDriveRendererToolbar()
  return <output data-browser-unsaved={String(hasUnsavedChanges)} />
}

function browserCurrent(): DriveBrowserItemDto {
  return {
    id: 'file',
    name: 'notes.md',
    type: 'file',
    size: '12',
    mimeType: 'text/markdown',
    updatedAt: '2026-09-08T00:00:00.000Z',
    previewKind: 'markdown',
    browserUrl: '/console/drive/items/file',
    downloadUrl: '/api/drive/items/file/content',
  }
}

function browserPreview(text: string): DriveBrowserPreviewDto {
  return {
    kind: 'markdown',
    text,
    html: '<h1>Notes</h1>',
    outline: [],
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    relativeImages: [],
  }
}

function browserEditable(currentVersionId = 'version-1'): DriveBrowserEditDto {
  return { canEdit: true, editorKind: 'text', currentVersionId, reason: null }
}

function browserEditContext() {
  const saveText = vi.fn<BrowserRendererOptions['editContext']['saveText']>(async () => ({} as never))
  return {
    reload: vi.fn(async () => ({} as never)),
    reloading: false,
    saveText,
    savingText: false,
  }
}

async function waitForRichEditor(): Promise<HTMLElement> {
  await expect.poll(() => document.querySelector<HTMLElement>('.drive-milkdown-editor .ProseMirror')).not.toBeNull()
  return document.querySelector<HTMLElement>('.drive-milkdown-editor .ProseMirror')!
}

async function replaceBlockText(editor: HTMLElement, text: string, replacement: string): Promise<void> {
  const block = Array.from(editor.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, p'))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!block) throw new Error(`Missing editor block: ${text}`)
  await userEvent.tripleClick(block)
  await userEvent.keyboard(replacement)
  await expect.poll(() => editor.textContent).toContain(replacement)
  await expect.poll(() => document.querySelector('[data-browser-unsaved]')?.getAttribute('data-browser-unsaved')).toBe('true')
}

async function saveWithKeyboard(context: ReturnType<typeof browserEditContext>): Promise<void> {
  await userEvent.keyboard('{Control>}s{/Control}')
  await expect.poll(() => context.saveText.mock.calls.length).toBe(1)
}
