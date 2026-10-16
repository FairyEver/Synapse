/** 复用仓库组件、主题与现有构建依赖，输出无需联网的单文件 HTML。 */
import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const repository = resolve(directory, "../../..")
const requireDesktop = createRequire(join(repository, "desktop/package.json"))
const requireTailwind = createRequire(requireDesktop.resolve("@tailwindcss/vite"))
const { build, transform } = requireDesktop("esbuild")
const { compile } = requireTailwind("@tailwindcss/node")
const { Scanner } = requireTailwind("@tailwindcss/oxide")

const javascript = await build({
  entryPoints: [join(directory, "prototype.tsx")], absWorkingDir: repository,
  nodePaths: [join(repository, "desktop/node_modules")], alias: { "@": join(repository, "desktop/src") },
  bundle: true, write: false, minify: true, format: "iife", platform: "browser", target: "es2022",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "offline-prototype-without-telemetry",
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/ui-tracking$/ }, () => ({ path: "tracking", namespace: "prototype" }))
      builder.onLoad({ filter: /.*/, namespace: "prototype" }, () => ({ contents: `
        export function track() {}
        export function extractLabel(element) { return element?.getAttribute?.("aria-label") ?? element?.textContent }
        export function mergeRefs(...refs) { return value => refs.forEach(ref => { if (typeof ref === "function") ref(value); else if (ref) ref.current = value }) }
      `, loader: "js" }))
    },
  }],
})
const globalStyles = join(repository, "desktop/src/styles/globals.css")
const theme = (await readFile(globalStyles, "utf8")).split("@layer base")[0]
const compiler = await compile(theme, { base: dirname(globalStyles), from: globalStyles, onDependency() {}, shouldRewriteUrls: true })
const scanner = new Scanner({ sources: [
  { base: directory, pattern: "*.tsx", negated: false },
  { base: join(repository, "desktop/src/components/ui"), pattern: "*.tsx", negated: false },
  { base: join(repository, "desktop/src/modules/mail"), pattern: "layout.tsx", negated: false },
] })
let css = compiler.build(scanner.scan())
const fontPackage = dirname(requireDesktop.resolve("@fontsource-variable/geist/package.json"))
for (const match of [...css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)]) {
  if (!match[2].endsWith(".woff2")) continue
  const bytes = await readFile(join(fontPackage, "files", basename(match[2])))
  css = css.replaceAll(match[0], `url(data:font/woff2;base64,${bytes.toString("base64")})`)
}
css = (await transform(css, { loader: "css", minify: true })).code
const script = javascript.outputFiles[0].text.replaceAll("</script", "<\\/script").replace(/[\t ]+$/gm, "")
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>站内信人员筛选 · Synapse 交互原型</title><style>${css}</style></head>
<body><div id="mail-prototype"></div><noscript>请启用 JavaScript 查看交互原型。</noscript><script>${script}</script></body></html>
`
await writeFile(join(directory, "index.html"), html)
process.stdout.write(`已生成 ${join(directory, "index.html")}（${Buffer.byteLength(html)} 字节）\n`)
