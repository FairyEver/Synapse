import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 复用已安装的 Dashboard React / HeroUI，不安装依赖、不启动服务。
const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../../..')
const dashboard = path.join(repository, 'dashboard')
const requireDashboard = createRequire(path.join(dashboard, 'package.json'))
const { build } = await import(requireDashboard.resolve('vite'))
const { default: react } = await import(requireDashboard.resolve('@vitejs/plugin-react'))
const { default: tailwindcss } = await import(requireDashboard.resolve('@tailwindcss/vite'))
const result = await build({
  configFile: false, root: directory, logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  resolve: { alias: [
    { find: /^@heroui\/styles\/css$/, replacement: requireDashboard.resolve('@heroui/styles/css') },
    { find: /^tailwindcss$/, replacement: requireDashboard.resolve('tailwindcss/index.css') },
    ...['react', 'react-dom', '@heroui/react', 'lucide-react'].map(name => ({ find: name, replacement: path.dirname(requireDashboard.resolve(`${name}/package.json`)) })),
  ] },
  build: { write: false, cssCodeSplit: false, assetsInlineLimit: Infinity,
    lib: { entry: path.join(directory, 'preview.tsx'), formats: ['iife'], name: 'PokerSettlementPreview' }, minify: true },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const output = Array.isArray(result) ? result.flatMap(item => item.output) : result.output
const script = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n')
if (!script || !css) throw new Error('原型未生成脚本或样式')
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>德州扑克 · 本局结算</title><style>${css}</style></head>
<body><div id="root"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>\n`
await writeFile(path.join(directory, 'index.html'), html)
process.stdout.write(`已生成离线 HTML：${path.join(directory, 'index.html')}\n`)
