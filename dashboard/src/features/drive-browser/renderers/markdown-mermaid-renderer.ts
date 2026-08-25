import type { Mermaid, MermaidConfig } from 'mermaid'

export type DriveMermaidResolvedTheme = 'light' | 'dark'

type DriveMermaidApi = Pick<Mermaid, 'initialize' | 'render'>
type DriveMermaidLoader = () => Promise<DriveMermaidApi>

type RenderDriveMermaidDiagramsInput = {
  readonly root: HTMLElement
  readonly resolvedTheme: DriveMermaidResolvedTheme
  readonly signal?: AbortSignal
  readonly loadMermaid?: DriveMermaidLoader
}

const MERMAID_SOURCE_SELECTOR = 'pre > code.language-mermaid'
const MERMAID_DIAGRAM_SELECTOR = '[data-drive-mermaid-diagram="true"]'
const MERMAID_ERROR_SELECTOR = '[data-drive-mermaid-error="true"]'
const MERMAID_SECURE_CONFIG_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'theme',
  'themeVariables',
  'themeCSS',
  'fontFamily',
  'htmlLabels',
]
const MERMAID_THEME_TOKENS = [
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
] as const

let nextMermaidDiagramId = 1
let mermaidRenderQueue: Promise<void> = Promise.resolve()

export async function renderDriveMermaidDiagrams({
  root,
  resolvedTheme,
  signal,
  loadMermaid = loadMermaidModule,
}: RenderDriveMermaidDiagramsInput): Promise<void> {
  restoreDriveMermaidDiagrams(root)
  const codeBlocks = Array.from(root.querySelectorAll<HTMLElement>(MERMAID_SOURCE_SELECTOR))
  if (codeBlocks.length === 0 || signal?.aborted) return

  let mermaid: DriveMermaidApi
  try {
    mermaid = await loadMermaid()
  } catch {
    if (!signal?.aborted) {
      codeBlocks.forEach((code) => {
        const pre = code.parentElement
        if (pre?.tagName === 'PRE' && pre.isConnected) showMermaidRenderError(pre)
      })
    }
    return
  }
  if (signal?.aborted) return
  const config = createDriveMermaidConfig(root, resolvedTheme)

  for (const code of codeBlocks) {
    if (signal?.aborted) return
    const source = code.textContent ?? ''
    const pre = code.parentElement
    if (!pre || pre.tagName !== 'PRE') continue
    try {
      const svg = await enqueueMermaidRender(async () => {
        mermaid.initialize(config)
        const result = await mermaid.render(`drive-mermaid-${nextMermaidDiagramId++}`, source)
        return result.svg
      })
      if (signal?.aborted || !pre.isConnected) return
      replaceMermaidSourceWithDiagram(pre, svg)
    } catch {
      if (signal?.aborted || !pre.isConnected) return
      showMermaidRenderError(pre)
    }
  }
}

export function restoreDriveMermaidDiagrams(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(MERMAID_DIAGRAM_SELECTOR).forEach((diagram) => {
    const source = diagram.querySelector<HTMLElement>('pre[data-drive-mermaid-source="true"]')
    if (!source) {
      diagram.remove()
      return
    }
    restoreMermaidSource(source)
    diagram.replaceWith(source)
  })
  root.querySelectorAll<HTMLElement>(MERMAID_ERROR_SELECTOR).forEach((error) => error.remove())
}

export function createDriveMermaidConfig(
  root: HTMLElement,
  resolvedTheme: DriveMermaidResolvedTheme,
): MermaidConfig {
  const themeVariables = resolveMermaidThemeVariables(root, resolvedTheme)
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    secure: MERMAID_SECURE_CONFIG_KEYS,
    htmlLabels: false,
    fontFamily: root.ownerDocument.defaultView?.getComputedStyle(root.ownerDocument.body).fontFamily || undefined,
    theme: themeVariables ? 'base' : resolvedTheme === 'dark' ? 'dark' : 'neutral',
    ...(themeVariables ? { themeVariables } : {}),
    flowchart: {
      htmlLabels: false,
      useMaxWidth: false,
    },
    sequence: {
      useMaxWidth: false,
    },
  }
}

function resolveMermaidThemeVariables(
  root: HTMLElement,
  resolvedTheme: DriveMermaidResolvedTheme,
): Record<string, string | boolean> | null {
  const document = root.ownerDocument
  const view = document.defaultView
  if (!view) return null
  const styles = view.getComputedStyle(document.documentElement)
  const tokens = new Map<string, string>()
  for (const token of MERMAID_THEME_TOKENS) {
    const value = styles.getPropertyValue(token).trim()
    if (!value) return null
    tokens.set(token, value)
  }
  const background = tokens.get('--background')
  if (!background) return null
  const colors = new Map<string, string>()
  for (const [token, value] of tokens) {
    const color = cssColorToOpaqueHex(document, value, background)
    if (!color) return null
    colors.set(token, color)
  }
  const color = (token: typeof MERMAID_THEME_TOKENS[number]) => colors.get(token)!
  return {
    darkMode: resolvedTheme === 'dark',
    background: color('--background'),
    primaryColor: color('--muted'),
    primaryTextColor: color('--foreground'),
    primaryBorderColor: color('--border'),
    secondaryColor: color('--secondary'),
    secondaryTextColor: color('--secondary-foreground'),
    secondaryBorderColor: color('--border'),
    tertiaryColor: color('--background'),
    tertiaryTextColor: color('--foreground'),
    tertiaryBorderColor: color('--border'),
    lineColor: color('--muted-foreground'),
    textColor: color('--foreground'),
    noteBkgColor: color('--muted'),
    noteTextColor: color('--foreground'),
    noteBorderColor: color('--border'),
    mainBkg: color('--background'),
    actorBkg: color('--background'),
    actorBorder: color('--border'),
    actorTextColor: color('--foreground'),
    signalColor: color('--muted-foreground'),
    signalTextColor: color('--foreground'),
    labelBoxBkgColor: color('--muted'),
    labelBoxBorderColor: color('--border'),
    labelTextColor: color('--foreground'),
    loopTextColor: color('--foreground'),
    activationBkgColor: color('--primary'),
    activationBorderColor: color('--primary-foreground'),
  }
}

function cssColorToOpaqueHex(document: Document, value: string, background: string): string | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = background
    context.fillRect(0, 0, 1, 1)
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
  } catch {
    return null
  }
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function replaceMermaidSourceWithDiagram(pre: HTMLElement, svgMarkup: string): void {
  const document = pre.ownerDocument
  const template = document.createElement('template')
  template.innerHTML = svgMarkup.trim()
  const svg = template.content.querySelector('svg')
  if (!svg) throw new Error('Mermaid did not return an SVG.')

  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', svg.querySelector('title')?.textContent?.trim() || 'Mermaid 流程图')
  svg.style.removeProperty('max-width')
  svg.classList.add('mx-auto', 'h-auto', 'w-auto', 'max-w-none')

  const diagram = document.createElement('figure')
  diagram.dataset.driveMermaidDiagram = 'true'
  diagram.className = 'mx-0 my-4 max-w-full overflow-x-auto rounded-md bg-muted/40 p-4'
  const rendered = document.createElement('div')
  rendered.dataset.driveMermaidRendered = 'true'
  rendered.className = 'min-w-fit'
  rendered.append(svg)
  diagram.append(rendered)

  pre.replaceWith(diagram)
  pre.dataset.driveMermaidSource = 'true'
  pre.setAttribute('aria-hidden', 'true')
  pre.classList.add('hidden')
  diagram.append(pre)
}

function showMermaidRenderError(pre: HTMLElement): void {
  const error = pre.ownerDocument.createElement('p')
  error.dataset.driveMermaidError = 'true'
  error.className = 'text-sm text-destructive'
  error.setAttribute('role', 'status')
  error.textContent = '无法渲染流程图，已显示源码。'
  pre.before(error)
}

function restoreMermaidSource(source: HTMLElement): void {
  source.removeAttribute('data-drive-mermaid-source')
  source.removeAttribute('aria-hidden')
  source.classList.remove('hidden')
}

function enqueueMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const result = mermaidRenderQueue.then(task, task)
  mermaidRenderQueue = result.then(() => undefined, () => undefined)
  return result
}

async function loadMermaidModule(): Promise<DriveMermaidApi> {
  return (await import('mermaid')).default
}
