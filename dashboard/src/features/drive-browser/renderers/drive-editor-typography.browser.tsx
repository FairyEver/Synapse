import '@/styles/index.css'
import '@milkdown/crepe/theme/common/style.css'
import '@mdxeditor/editor/style.css'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

let host: HTMLElement | null = null
let lateVendorStyle: HTMLStyleElement | null = null

afterEach(() => {
  host?.remove()
  lateVendorStyle?.remove()
  host = null
  lateVendorStyle = null
})

describe('drive editor typography in Chromium', () => {
  it('keeps semantic typography identical across Milkdown and MDXEditor', () => {
    const roots = renderEditorFixtures()

    for (const selector of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'code', 'pre', 'table', 'th', 'td']) {
      expectComparableStyles(roots.milkdown, roots.mdxeditor, selector)
    }

    expect(getComputedStyle(roots.milkdown.querySelector('h1')!).fontSize).toBe('32px')
    expect(getComputedStyle(roots.milkdown.querySelector('h6')!).fontSize).toBe('16px')
    expect(getComputedStyle(roots.milkdown.querySelector('p')!).lineHeight).toBe('24px')
    expect(getComputedStyle(roots.milkdown.querySelector('code')!).color).toBe(getComputedStyle(roots.mdxeditor).color)
  })

  it('wins over editor styles that are injected after the project stylesheet', () => {
    const roots = renderEditorFixtures()
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
    const roots = renderEditorFixtures()
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
    const roots = renderEditorFixtures()
    const milkdownList = roots.milkdown.querySelector<HTMLElement>('ul')!
    const mdxeditorList = roots.mdxeditor.querySelector<HTMLElement>('ul')!
    const milkdownLabel = roots.milkdown.querySelector<HTMLElement>('.label-wrapper')!

    expect(getComputedStyle(milkdownList).marginBottom).toBe(getComputedStyle(mdxeditorList).marginBottom)
    expect(getComputedStyle(milkdownList).paddingInlineStart).toBe('0px')
    expect(getComputedStyle(milkdownLabel).width).toBe(getComputedStyle(mdxeditorList).paddingInlineStart)
    expect(getComputedStyle(roots.milkdown.querySelector('.children p')!).marginBottom).toBe('0px')
  })

  it('does not apply document-cell styling to MDXEditor table controls', () => {
    const { mdxeditor } = renderEditorFixtures()
    const contentCell = mdxeditor.querySelector<HTMLElement>('td:not([data-tool-cell])')!
    const toolCell = mdxeditor.querySelector<HTMLElement>('td[data-tool-cell]')!

    expect(getComputedStyle(contentCell).paddingInlineStart).toBe('12px')
    expect(getComputedStyle(toolCell).paddingInlineStart).not.toBe('12px')
  })

  it('restores themed keyboard focus after the Crepe reset without outlining the editor surface', async () => {
    const { milkdown } = renderEditorFixtures()
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

function renderEditorFixtures(): { readonly milkdown: HTMLElement; readonly mdxeditor: HTMLElement } {
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
