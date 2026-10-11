/** 用仓库已有运行时和组件构建独立原型，不启动应用或服务器。 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve, basename, join } from "node:path"
import { fileURLToPath } from "node:url"

const sourceDir = dirname(fileURLToPath(import.meta.url))
const repository = resolve(sourceDir, "../../..")
const outputDir = process.argv[2]
if (!outputDir) throw new Error("提供原型输出目录")
const outputPath = resolve(outputDir)
const requireDesktop = createRequire(join(repository, "desktop/package.json"))
const requireTailwind = createRequire(requireDesktop.resolve("@tailwindcss/vite"))
const { build, transform } = requireDesktop("esbuild")
const { compile } = requireTailwind("@tailwindcss/node")
const { Scanner } = requireTailwind("@tailwindcss/oxide")

const trackingStub = {
  name: "prototype-without-telemetry",
  setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/ui-tracking$/ }, () => ({ path: "tracking", namespace: "prototype" }))
    builder.onLoad({ filter: /.*/, namespace: "prototype" }, () => ({ contents: `
      export function track() {}
      export function extractLabel(element) { return element?.getAttribute?.("aria-label") ?? element?.textContent }
      export function mergeRefs(...refs) { return value => refs.forEach(ref => { if (typeof ref === "function") ref(value); else if (ref) ref.current = value }) }
    `, loader: "js" }))
  },
}
const javascript = await build({
  entryPoints: [join(sourceDir, "prototype.tsx")],
  absWorkingDir: repository,
  nodePaths: [join(repository, "desktop/node_modules")],
  alias: { "@": join(repository, "desktop/src") },
  bundle: true, write: false, minify: true, format: "iife", platform: "browser", target: "es2022",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [trackingStub], metafile: true,
})
// 使用当前产品的 import、主题、字号及 radius。应用全屏和工作流布局不属于原型。
const globalStyles = join(repository, "desktop/src/styles/globals.css")
const theme = (await readFile(globalStyles, "utf8")).split("@layer base")[0]
const compiler = await compile(theme, { base: dirname(globalStyles), from: globalStyles, onDependency() {}, shouldRewriteUrls: true })
const scanner = new Scanner({ sources: [
  { base: sourceDir, pattern: "*.tsx", negated: false },
  { base: join(repository, "desktop/src/components/ui"), pattern: "*.tsx", negated: false },
  { base: join(repository, "desktop/src/modules/apps/components"), pattern: "*.tsx", negated: false },
] })
let css = compiler.build(scanner.scan())
const fontPackage = dirname(requireDesktop.resolve("@fontsource-variable/geist/package.json"))
for (const match of [...css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)]) {
  const asset = match[2]
  if (!asset.endsWith(".woff2")) continue
  const data = await readFile(join(fontPackage, "files", basename(asset)))
  css = css.replaceAll(match[0], `url(data:font/woff2;base64,${data.toString("base64")})`)
}
css = (await transform(css, { loader: "css", minify: true })).code
const template = await readFile(join(sourceDir, "fragment.template.html"), "utf8")
const js = javascript.outputFiles[0].text
const fragment = template.replace("/* PROTOTYPE_COMPILED_CSS */", () => css).replace("/* PROTOTYPE_COMPILED_JS */", () => js.replaceAll("</script", "<\\/script"))
if (Buffer.byteLength(fragment) > 1000000) throw new Error("原型超过内联展示上限")
await mkdir(outputPath, { recursive: true })
await writeFile(join(outputPath, "synapse-todos.html"), fragment)
await writeFile(join(outputPath, "prototype.js"), js)
await writeFile(join(outputPath, "prototype.css"), css)
await writeFile(join(outputPath, "build-inputs.json"), JSON.stringify(Object.keys(javascript.metafile.inputs), null, 2))
process.stdout.write(`已构建 ${join(outputPath, "synapse-todos.html")}（${Buffer.byteLength(fragment)} 字节）\n`)
