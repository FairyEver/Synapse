import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 用现有 dashboard 组件、主题和依赖生成离线预览，不启动应用或连接业务 API。
const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../../..')
const dashboard = path.join(repository, 'dashboard')
const requireDashboard = createRequire(path.join(dashboard, 'package.json'))
const { build } = await import(requireDashboard.resolve('vite'))
const { default: react } = await import(requireDashboard.resolve('@vitejs/plugin-react'))
const { default: tailwindcss } = await import(requireDashboard.resolve('@tailwindcss/vite'))
const cssId = path.join(dashboard, 'comment-status-preview.css')
const entryId = path.join(dashboard, 'comment-status-preview.tsx')
const source = await readFile(path.join(directory, 'preview.tsx'), 'utf8')
const cssSource = [
  '@import "tailwindcss" source(none);',
  '@import "tw-animate-css";',
  '@import "./src/styles/theme.css";',
  '@source "./src/components/ui";',
  `@source "${path.join(directory, 'preview.tsx')}";`,
].join('\n')

const result = await build({
  configFile: false,
  root: dashboard,
  logLevel: 'warn',
  plugins: [
    {
      name: 'comment-status-preview-source',
      resolveId(id) {
        if (id === entryId || id === cssId) return id
      },
      load(id) {
        if (id === entryId) return `import ${JSON.stringify(cssId)};\n${source}`
        if (id === cssId) return cssSource
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.join(dashboard, 'src') } },
  build: {
    write: false,
    cssCodeSplit: false,
    lib: { entry: entryId, formats: ['iife'], name: 'CommentStatusPreview' },
    minify: true,
  },
  define: { 'process.env.NODE_ENV': '"production"' },
})

const output = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output
const script = output.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n').replace(/[\t ]+$/gm, '')
const css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')).map((item) => item.source).join('\n')
if (!script || !css) throw new Error('预览构建没有生成脚本或样式')

const fragment = `<div id="comment-status-preview" class="viz-carousel" aria-label="评论状态设计" data-previous-label="上一方案" data-next-label="下一方案">
  <section data-variant="紧凑标题" aria-label="紧凑标题方案"><div id="comment-status-compact"></div></section>
  <section data-variant="文字操作" aria-label="文字操作方案" hidden><div id="comment-status-text"></div></section>
</div>
<style>${css}</style>
<script>${script.replaceAll('</script', '<\\/script')}</script>
`

// 独立网页复用 Button 切换方案；内嵌预览使用宿主提供的方案切换器。
const standaloneFragment = fragment.replace('<script>', '<div id="comment-status-switcher"></div>\n<script>')
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synapse 评论状态设计</title></head><body>${standaloneFragment}</body></html>\n`
const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(directory, 'preview-inline.html')
await writeFile(destination, fragment)
await writeFile(path.join(directory, 'index.html'), html)
process.stdout.write(`已生成评论状态预览：${path.join(directory, 'index.html')}\n`)
