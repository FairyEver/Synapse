import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Only builds the review artifact. Does not start a server or open a browser.
const directory = path.dirname(fileURLToPath(import.meta.url))
const desktop = path.resolve(directory, '../../../desktop')
const requireDesktop = createRequire(path.join(desktop, 'package.json'))
const { build } = await import(requireDesktop.resolve('vite'))
const { default: react } = await import(requireDesktop.resolve('@vitejs/plugin-react'))
const { default: tailwindcss } = await import(requireDesktop.resolve('@tailwindcss/vite'))
const source = await readFile(path.join(directory, 'preview.tsx'), 'utf8')
const globals = await readFile(path.join(desktop, 'src/styles/globals.css'), 'utf8')
const theme = globals.match(/@theme inline \{[\s\S]*?\n\}/)?.[0]
const tokens = globals.match(/:root \{[\s\S]*?\n\}/)?.[0]
if (!theme || !tokens) throw new Error('无法读取桌面主题 token')

// Pinned prototype-only capture engine. No package.json / lockfile changes.
const engineUrl = 'https://cdn.jsdelivr.net/npm/@zumer/snapdom@3.3.7/dist/snapdom.mjs'
const response = await fetch(engineUrl, { signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`SnapDOM 下载失败：${response.status}`)
const engine = await response.text()
const digest = createHash('sha256').update(engine).digest('hex')
if (digest !== '619370dbaaed497368469d47bdfcf7b5ad101d6f366cc020cb5fe9519eed273a') {
  throw new Error('SnapDOM 3.3.7 内容校验失败')
}
const licenseResponse = await fetch('https://raw.githubusercontent.com/zumerlab/snapdom/v3.3.7/LICENSE', { signal: AbortSignal.timeout(30_000) })
if (!licenseResponse.ok) throw new Error('无法读取 SnapDOM 许可证')
const license = await licenseResponse.text()
const entryId = path.join(desktop, 'conversation-share-prototype.tsx')
const cssId = path.join(desktop, 'conversation-share-prototype.css')
const css = [
  '@import "tailwindcss" source(none);',
  '@import "tw-animate-css";',
  '@import "shadcn/tailwind.css";',
  theme,
  tokens,
  '@layer base { * { @apply border-border outline-ring/50; } body { @apply bg-background text-foreground font-sans; margin: 0; } }',
  '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }',
  `@source "${path.join(directory, 'preview.tsx')}";`,
  ...['button', 'checkbox', 'switch', 'input', 'label', 'dialog'].map((name) => `@source "./src/components/ui/${name}.tsx";`),
  '@source "./src/modules/agent/components/agent-message-bubble.tsx";',
  '@source "./src/modules/agent/components/agent-composer-input-box.tsx";',
].join('\n')
const result = await build({
  configFile: false,
  root: desktop,
  logLevel: 'warn',
  plugins: [
    {
      name: 'conversation-share-prototype',
      resolveId(id) {
        if ([entryId, cssId, 'prototype-snapdom', '\0prototype-tracking'].includes(id)) return id
      },
      load(id) {
        if (id === entryId) return `import ${JSON.stringify(cssId)};\n${source}`
        if (id === cssId) return css
        if (id === 'prototype-snapdom') return engine
        if (id === '\0prototype-tracking') return 'export const track = () => {}; export const extractLabel = (el) => el.getAttribute("aria-label") || el.textContent?.trim(); export const mergeRefs = (...refs) => (value) => { for (const ref of refs) { if (typeof ref === "function") ref(value); else if (ref) ref.current = value; } };'
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: [
    { find: '@/lib/ui-tracking', replacement: '\0prototype-tracking' },
    { find: '@capabilities', replacement: path.join(desktop, 'app-capabilities') },
    { find: '@', replacement: path.join(desktop, 'src') },
  ] },
  build: { write: false, cssCodeSplit: false, lib: { entry: entryId, formats: ['iife'], name: 'SynapseSharePrototype' }, minify: true },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const output = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output
const script = output.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n').replaceAll('</script', '<\\/script').replace(/[\t ]+$/gm, '')
const styles = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')).map((item) => item.source).join('\n')
if (!script || !styles) throw new Error('原型未生成脚本或样式')
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src data: blob:; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>对话分享 · Synapse 交互原型</title><style>${styles}</style></head>
<body><div id="root"></div><noscript>请启用 JavaScript 查看对话分享原型。</noscript>
<!-- Third-party notice: @zumer/snapdom 3.3.7, ${engineUrl}\n${license.replaceAll('--', '—')} -->
<script>${script}</script></body></html>\n`
await writeFile(path.join(directory, 'index.html'), html)
process.stdout.write(`已生成 ${path.join(directory, 'index.html')}（${Buffer.byteLength(html)} 字节，离线可用，未打开浏览器）\n`)
