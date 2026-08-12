import '@/styles/index.css'
import { afterEach, describe, expect, it } from 'vitest'
import { renderDriveMermaidDiagrams } from './markdown-mermaid-renderer'

let root: HTMLElement | null = null

afterEach(() => {
  root?.remove()
  root = null
  document.documentElement.classList.remove('light', 'dark')
})

describe('drive markdown Mermaid renderer in Chromium', () => {
  it('renders the diagram types used by the shared Markdown document', async () => {
    document.documentElement.classList.add('light')
    root = document.createElement('main')
    for (const source of [
      'stateDiagram-v2\n    [*] --> Unpaired\n    Unpaired --> Paired: Confirm',
      'flowchart TB\n    App[Mobile] --> Server[Synapse Server]\n    Server --> Desktop[Synapse Desktop]',
      'flowchart LR\n    Protocol[Remote Protocol] --> iOS[SwiftUI Renderer]\n    Protocol --> Android[Compose Renderer]',
      'sequenceDiagram\n    participant App\n    participant Server\n    App->>Server: command\n    Server-->>App: accepted',
    ]) {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.className = 'language-mermaid'
      code.textContent = source
      pre.append(code)
      root.append(pre)
    }
    document.body.append(root)

    await renderDriveMermaidDiagrams({ root, resolvedTheme: 'light' })

    const diagrams = root.querySelectorAll('[data-drive-mermaid-diagram="true"]')
    expect(diagrams).toHaveLength(4)
    expect(root.querySelectorAll('[data-drive-mermaid-rendered="true"] svg')).toHaveLength(4)
    expect(Array.from(root.querySelectorAll('svg')).every((svg) => svg.hasAttribute('viewBox'))).toBe(true)
    expect(root.querySelector('[data-drive-mermaid-error="true"]')).toBeNull()
  })

  it('renders from the dark theme tokens', async () => {
    document.documentElement.classList.add('dark')
    root = document.createElement('main')
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.className = 'language-mermaid'
    code.textContent = 'flowchart LR\n    Dark --> Theme'
    pre.append(code)
    root.append(pre)
    document.body.append(root)

    await renderDriveMermaidDiagrams({ root, resolvedTheme: 'dark' })

    expect(root.querySelector('[data-drive-mermaid-rendered="true"] svg')).not.toBeNull()
    expect(root.querySelector('[data-drive-mermaid-error="true"]')).toBeNull()
  })
})
