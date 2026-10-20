/** 输出可离线打开的 HTML，复用已安装的 React、shadcn 和产品主题。 */
import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve, join, basename } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const repository = resolve(directory, "../../..")
const desktop = createRequire(join(repository, "desktop/package.json"))
const tailwind = createRequire(desktop.resolve("@tailwindcss/vite"))
const esbuild = desktop("esbuild")
const result = await esbuild.build({
  absWorkingDir: repository, entryPoints: [join(directory, "prototype.tsx")],
  nodePaths: [join(repository, "desktop/node_modules")], alias: { "@": join(repository, "desktop/src") },
  loader: { ".svg": "dataurl" }, jsx: "automatic", bundle: true, minify: true,
  write: false, metafile: true, platform: "browser", target: "es2022", format: "iife",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [{ name: "disable-prototype-telemetry", setup(build) {
    build.onResolve({ filter: /^@\/lib\/ui-tracking$/ }, () => ({ path: "tracking", namespace: "demo" }))
    build.onLoad({ filter: /.*/, namespace: "demo" }, () => ({ contents: `
      export const track = () => undefined;
      export const extractLabel = element => element?.getAttribute?.("aria-label") ?? element?.textContent;
      export const mergeRefs = (...refs) => value => refs.forEach(ref => typeof ref === "function" ? ref(value) : ref && (ref.current = value));
      export const debounce = () => () => undefined;
    ` }))
  } }],
})

const globals = join(repository, "desktop/src/styles/globals.css")
const { compile } = tailwind("@tailwindcss/node")
const compiler = await compile((await readFile(globals, "utf8")).split("@layer base")[0], {
  base: dirname(globals), from: globals, shouldRewriteUrls: true, onDependency() {},
})
const { Scanner } = tailwind("@tailwindcss/oxide")
const candidates = new Scanner({ sources: Object.keys(result.metafile.inputs)
  .filter(file => /\.tsx?$/.test(file))
  .map(file => ({ base: dirname(resolve(repository, file)), pattern: basename(file), negated: false })) }).scan()
let styles = compiler.build(candidates)
const fontDirectory = join(dirname(desktop.resolve("@fontsource-variable/geist/package.json")), "files")
for (const [url, , font] of styles.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)) {
  if (!font.endsWith(".woff2")) continue
  styles = styles.replaceAll(url, `url(data:font/woff2;base64,${(await readFile(join(fontDirectory, basename(font)))).toString("base64")})`)
}
styles = (await esbuild.transform(styles, { loader: "css", minify: true })).code
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script").replace(/[\t ]+$/gm, "")
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>云盘文件搜索 · Synapse 交互原型</title><style>${styles}</style></head>
<body class="bg-background text-foreground font-sans"><div id="drive-prototype"></div><noscript>请启用 JavaScript 查看交互原型。</noscript><script>${script}</script></body></html>
`
await writeFile(join(directory, "index.html"), html)
process.stdout.write(`已生成 ${join(directory, "index.html")}（${Buffer.byteLength(html)} 字节）\n`)
