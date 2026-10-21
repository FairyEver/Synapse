import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 复用现有原型构建方式：仅编译现有 dashboard 组件、Tailwind 和主题，无服务、无网络。
const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../../..')
const dashboard = path.join(repository, 'dashboard')
const requireDashboard = createRequire(path.join(dashboard, 'package.json'))
const { build } = await import(requireDashboard.resolve('vite'))
const { default: react } = await import(requireDashboard.resolve('@vitejs/plugin-react'))
const { default: tailwindcss } = await import(requireDashboard.resolve('@tailwindcss/vite'))
const cssId = path.join(dashboard, 'markdown-reading-prototype.css')
const entryId = path.join(dashboard, 'markdown-reading-prototype.tsx')
const source = await readFile(path.join(directory, 'preview.tsx'), 'utf8')
const cssSource = [
  '@import "tailwindcss" source(none);',
  '@import "tw-animate-css";',
  '@import "./src/styles/theme.css";',
  '@source "./src/components/ui/button.tsx";',
  '@source "./src/components/ui/table.tsx";',
  `@source "${path.join(directory, 'preview.tsx')}";`,
].join('\n')

const result = await build({
  configFile: false,
  root: dashboard,
  logLevel: 'warn',
  plugins: [
    {
      name: 'markdown-reading-prototype',
      resolveId(id) { if (id === entryId || id === cssId) return id },
      load(id) {
        if (id === entryId) return `import ${JSON.stringify(cssId)};\n${source}`
        if (id === cssId) return cssSource
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.join(dashboard, 'src') } },
  build: { write: false, cssCodeSplit: false, lib: { entry: entryId, formats: ['iife'], name: 'MarkdownReadingPrototype' }, minify: true },
  define: { 'process.env.NODE_ENV': '"production"' },
})

const output = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output
const script = output.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n').replaceAll('</script', '<\\/script').replace(/[\t ]+$/gm, '')
const css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')).map((item) => item.source).join('\n')
if (!script || !css) throw new Error('原型构建没有生成脚本或样式')
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Markdown 阅读布局原型 · Synapse</title><style>${css}</style></head>
<body><div id="root"></div><noscript>请启用 JavaScript 查看阅读布局原型。</noscript><script>${script}</script></body></html>
`
await writeFile(path.join(directory, 'index.html'), html)
process.stdout.write(`已生成 ${path.join(directory, 'index.html')}（${Buffer.byteLength(html)} 字节）\n`)
