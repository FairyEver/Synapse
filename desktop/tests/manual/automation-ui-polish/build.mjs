import { build } from "esbuild"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const dest = path.join(repo, ".superpowers/sdd/automation-ui-polish")
const result = await build({
  entryPoints: [fileURLToPath(new URL("preview.tsx", import.meta.url))], absWorkingDir: repo, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@": path.join(repo, "desktop/src") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.MODE": '"production"' },
  plugins: [{ name: "preview-contexts", setup(b) {
    b.onResolve({ filter: /^@\/app-shell\/(config|notifications)$/ }, args => ({ path: args.path.split("/").pop(), namespace: "preview" }))
    b.onLoad({ filter: /.*/, namespace: "preview" }, args => ({ contents: args.path === "notifications"
      ? "export const useAppNotifications = () => ({promise: async source => typeof source === 'function' ? source() : source});"
      : `import {useSyncExternalStore} from '${path.join(repo, "desktop/node_modules/react/index.js")}';let config={global:{projects:new URLSearchParams(location.search).has('emptySources')?[]:[{id:'preview-project',name:'Synapse界面验证项目',path:'/preview/project'}]}};const listeners=new Set();export function useAppConfig(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>config);return {config,refreshConfig:async()=>config,updateConfig:async patch=>{config={...config,global:{...config.global,...patch.global}};listeners.forEach(fn=>fn())}}}`,
      loader: "js", resolveDir: repo }))
  } }],
})
const assets = path.join(repo, "desktop/dist/assets")
const cssFile = readdirSync(assets).find(name => /^index-.*\.css$/.test(name))
if (!cssFile) throw Error("Run pnpm --filter @synapse/desktop build:renderer first")
const css = readFileSync(path.join(assets, cssFile), "utf8").replace(/url\(([^)]+)\)/g, (match, raw) => {
  const name = raw.replace(/["']/g, "")
  return name.startsWith("data:") ? match : `url('/console/@fs${path.join(assets, name)}')`
})
mkdirSync(dest, { recursive: true })
writeFileSync(path.join(dest, "preview.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>自动化当前组件验证</title><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`)
process.stdout.write(path.join(dest, "preview.html") + "\n")
